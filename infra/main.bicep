// Spec 004: all Azure resources for the Weather Summary Function App.
// Deploy to an existing resource group:
//   az deployment group create -g <rg> -f infra/main.bicep -p infra/main.bicepparam
// See docs/deploy.md for the full first-deployment runbook.

targetScope = 'resourceGroup'

// ---------- Parameters (R52) ----------

@description('Azure region for all resources. Defaults to the resource group\'s region.')
param location string = resourceGroup().location

@description('Short prefix for resource names: 3-11 lowercase letters/digits (it becomes part of the storage account name).')
@minLength(3)
@maxLength(11)
param namePrefix string

@description('Snapshot locations, format: id=lat,lon; id=lat,lon (spec 003 R36).')
param snapshotLocations string

@description('Flex Consumption instance cap: a cost ceiling for the anonymous endpoint (spec 004 R53 / D26).')
@minValue(1)
@maxValue(1000)
param maximumInstanceCount int = 10

@description('Memory per instance in MB.')
@allowed([
  512
  2048
  4096
])
param instanceMemoryMB int = 2048

// ---------- Names ----------

var suffix = uniqueString(resourceGroup().id)
var storageAccountName = toLower('${namePrefix}${take(suffix, 13)}') // <= 24 chars, lowercase alphanumeric
var deploymentContainerName = 'app-package'

// Built-in role definition IDs (spec 004 R51).
var roleIds = {
  storageBlobDataOwner: 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b' // host runtime + deployment package
  storageQueueDataContributor: '974c5e8b-45b9-4653-ba55-5f855dd0fb88' // host runtime
  storageTableDataContributor: '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3' // snapshots (spec 003)
}

// ---------- Monitoring (R50) ----------

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${namePrefix}-logs-${suffix}'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${namePrefix}-ai-${suffix}'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

// ---------- Storage (R50, R51) ----------

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    allowSharedKeyAccess: false // R51: keys are unusable even if leaked
    defaultToOAuthAuthentication: true
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource deploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: deploymentContainerName
}

// ---------- Hosting (R50, R53 / D25) ----------

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: '${namePrefix}-plan-${suffix}'
  location: location
  kind: 'functionapp'
  sku: {
    tier: 'FlexConsumption'
    name: 'FC1'
  }
  properties: {
    reserved: true // Linux
  }
}

resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: '${namePrefix}-func-${suffix}'
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned' // D27
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      minTlsVersion: '1.2'
      // R56: exactly these settings. Tuning knobs (OPEN_METEO_BASE_URL, UPSTREAM_*) are
      // deliberately absent so code defaults apply. FUNCTIONS_WORKER_RUNTIME is not used on
      // Flex Consumption: the runtime comes from functionAppConfig.runtime below.
      appSettings: [
        {
          name: 'AzureWebJobsStorage__accountName' // identity-based host storage (R51)
          value: storage.name
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
        {
          name: 'SNAPSHOT_LOCATIONS'
          value: snapshotLocations
        }
      ]
    }
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}${deploymentContainerName}'
          authentication: {
            type: 'SystemAssignedIdentity' // no key for the deployment package either
          }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: maximumInstanceCount
        instanceMemoryMB: instanceMemoryMB
      }
      runtime: {
        name: 'node'
        version: '22'
      }
    }
  }
}

// ---------- Access: managed identity → storage (R51) ----------

resource roleAssignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for role in items(roleIds): {
    name: guid(storage.id, functionApp.id, role.value)
    scope: storage
    properties: {
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', role.value)
      principalId: functionApp.identity.principalId
      principalType: 'ServicePrincipal'
    }
  }
]

// ---------- Outputs (no secrets) ----------

output functionAppName string = functionApp.name
output functionAppHostName string = functionApp.properties.defaultHostName
output storageAccountName string = storage.name
