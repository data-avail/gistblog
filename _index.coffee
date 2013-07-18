###
Read comman line parameters
  0. node
  1. filename (_index)
  2. app file name
  3. config file name
  4. app name
  5. nodetime key
###
appFileName = process.argv[2]
configFileName = process.argv[3]
appName = process.argv[4]
nodetimeKey = process.argv[5]

if nodetimeKey
  require('nodetime').profile
    accountKey: nodetimeKey
    appName: appName

###
  Read config file and setup env parameters
###

process.env["APP_NAME"] = appName
process.env["NODETIME_KEY"] = nodetimeKey

fs = require "fs"
endOfLine = require("os").EOL;

if configFileName
  lines = fs.readFileSync(configFileName, "utf-8").toString().split(endOfLine)
  for line in lines.filter((f) -> f)
    spt = line.split('=')
    process.env[spt[0]] = spt[1]
    console.log spt[0], process.env[spt[0]]

app = require appFileName

app.start (err) ->
  console.log "index [#{process.env["APP_NAME"]}] strated", err