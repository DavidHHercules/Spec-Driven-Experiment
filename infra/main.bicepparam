// Example parameter values (spec 004 R52). Copy and adjust per environment.
using './main.bicep'

param namePrefix = 'wxsnap'
param snapshotLocations = 'seattle=47.6,-122.3; london=51.5072,-0.1276; tokyo=35.6764,139.65'
param maximumInstanceCount = 10
