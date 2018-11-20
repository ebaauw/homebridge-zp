// homebridge-zp/lib/ZpPlatform.js
// Copyright © 2016-2018 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.
//
// TODO:
// - Upgrade to sonos@1.x asynchronous interface.

'use strict'

const http = require('http')
const homebridgeLib = require('homebridge-lib')
const os = require('os')
const semver = require('semver')
const SonosModule = require('sonos')
const util = require('util')
const xml2js = require('xml2js')

const ZpAccessoryModule = require('./ZpAccessory')
const ZpAccessory = ZpAccessoryModule.ZpAccessory
const packageJson = require('../package.json')

module.exports = {
  ZpPlatform: ZpPlatform,
  setHomebridge: setHomebridge
}

function minVersion (range) {
  let s = range.split(' ')[0]
  while (s) {
    if (semver.valid(s)) {
      break
    }
    s = s.substring(1)
  }
  return s || undefined
}

// Convert string with IP address to int.
function ipToInt (ipaddress) {
  const a = ipaddress.split('.')
  return a[0] << 24 | a[1] << 16 | a[2] << 8 | a[3]
}

// Check whether ip1 and ip2 are in the same network.
function inSameNetwork (ip1, ip2, netmask) {
  return (ipToInt(ip1) & ipToInt(netmask)) === (ipToInt(ip2) & ipToInt(netmask))
}

// Find my address for network of ip.
function findMyAddressFor (ip) {
  const interfaces = os.networkInterfaces()
  for (const id in interfaces) {
    const aliases = interfaces[id]
    for (const aid in aliases) {
      const alias = aliases[aid]
      if (
        alias.family === 'IPv4' && alias.internal === false &&
        inSameNetwork(ip, alias.address, alias.netmask)
      ) {
        return alias.address
      }
    }
  }
  return '0.0.0.0'
}

// =======================================================================================
//
// Link platform module to Homebridge.

let Service
let Characteristic
let homebridgeVersion
let _homebridge
let my

function setHomebridge (homebridge) {
  // Link accessory modules to Homebridge.
  ZpAccessoryModule.setHomebridge(homebridge)

  my = new homebridgeLib.MyHomeKitTypes(homebridge)

  Service = homebridge.hap.Service
  Characteristic = homebridge.hap.Characteristic
  homebridgeVersion = homebridge.serverVersion
  _homebridge = homebridge
}

// =======================================================================================

// Constructor for ZpPlatform.  Called by homebridge on load time.
function ZpPlatform (log, config) {
  this.log = log
  this.name = config.name || 'ZP'
  this.host = config.host
  this.port = config.port || 0
  this.nameScheme = config.nameScheme || '% Sonos'
  this.packageJson = packageJson
  this.my = my
  switch (config.service) {
    case undefined:
      /* Falls through */
    case 'switch':
      this.SpeakerService = Service.Switch
      this.VolumeCharacteristic = config.brightness ? Characteristic.Brightness : Characteristic.Volume
      break
    case 'light':
      this.SpeakerService = Service.Lightbulb
      this.VolumeCharacteristic = Characteristic.Brightness
      break
    case 'speaker':
      this.SpeakerService = Service.Speaker
      this.VolumeCharacteristic = config.brightness ? Characteristic.Brightness : Characteristic.Volume
      break
    case 'fan':
      this.SpeakerService = Service.Fan
      this.VolumeCharacteristic = Characteristic.RotationSpeed
      break
    default:
      this.log.error('config.json: warning: ignoring unknown service \'%s\'', config.service)
      this.SpeakerService = Service.Switch
      this.VolumeCharacteristic = Characteristic.Volume
      break
  }
  this.speakers = config.speakers || false
  this.leds = config.leds || false
  this.alarms = config.alarms || false
  this.resetTimeout = config.resetTimeout || 250 // milliseconds
  this.searchTimeout = config.searchTimeout || 15 // seconds
  this.searchTimeout *= 1000 // milliseconds
  this.subscriptionTimeout = config.subscriptionTimeout || 30 // minutes
  this.subscriptionTimeout *= 60 // seconds

  this.players = []
  this.zpAccessories = {}

  var msg = util.format(
    '%s v%s, node %s, homebridge v%s', packageJson.name,
    packageJson.version, process.version, homebridgeVersion
  )
  this.infoMessage = msg
  this.log.info(this.infoMessage)
  if (semver.clean(process.version) !== minVersion(packageJson.engines.node)) {
    this.log.warn(
      'warning: not using recommended node version v%s LTS',
      minVersion(packageJson.engines.node)
    )
  }
  if (homebridgeVersion !== minVersion(packageJson.engines.homebridge)) {
    this.log.warn(
      'warning: not using recommended homebridge version v%s',
      minVersion(packageJson.engines.homebridge)
    )
  }
  this.log.debug('config.json: %j', config)

  this.parser = new xml2js.Parser()

  process.on('exit', () => { this.log.info('exit') })
  _homebridge.on('shutdown', this.onExit.bind(this))
  if (process.listenerCount('uncaughtException') === 0) {
    process.on('uncaughtException', (error) => {
      this.log.error('uncaught exception\n%s', error.stack)
      if (!this.shuttingDown) {
        process.kill(process.pid, 'SIGTERM')
      }
    })
  }
  this.findPlayers()
}

// Called by homebridge to retrieve static list of ZpAccessories.
ZpPlatform.prototype.accessories = function (callback) {
  let accessoryList = []
  // Allow for search to find all Sonos ZonePlayers.
  setTimeout(() => {
    this.listen(() => {
      for (const zp of this.players) {
        const accessory = new ZpAccessory(this, zp)
        this.zpAccessories[zp.id] = accessory
        accessoryList.push(accessory)
      }
      return callback(accessoryList)
    })
  }, this.searchTimeout)
  const npmRegistry = new homebridgeLib.RestClient({
    host: 'registry.npmjs.org',
    name: 'npm registry'
  })
  npmRegistry.get(packageJson.name).then((response) => {
    if (
      response && response['dist-tags'] &&
      response['dist-tags'].latest !== packageJson.version
    ) {
      this.log.warn(
        'warning: lastest version: %s v%s', packageJson.name,
        response['dist-tags'].latest
      )
    }
  }).catch((err) => {
    this.log.error('%s', err)
  })
}

// Create listener to receive notifications from Sonos ZonePlayers.
ZpPlatform.prototype.listen = function (callback) {
  if (this.players.length === 0) {
    this.host = this.host || '0.0.0.0'
    this.log.warn('no zoneplayers found')
  } else {
    this.host = this.host || findMyAddressFor(this.players[0].host)
    if (this.host === '0.0.0.0') {
      this.log.error('cannot find network interface to zoneplayers')
    }
  }
  this.server = http.createServer((request, response) => {
    let buffer = ''
    request.on('data', (data) => {
      buffer += data
    })
    request.on('end', () => {
      request.body = buffer
      // this.log.debug('listener: %s %s', request.method, request.url)
      if (request.method === 'GET' && request.url === '/notify') {
        // Provide an easy way to check that listener is reachable.
        response.writeHead(200, { 'Content-Type': 'text/plain' })
        response.write(this.infoMessage)
      } else if (request.method === 'NOTIFY') {
        const array = request.url.split('/')
        const accessory = this.zpAccessories[array[2]]
        const service = array[4] != null ? array[4] : array[3]
        if (array[1] === 'notify' && accessory !== null && service !== null) {
          this.parser.parseString(request.body.toString(), (err, json) => {
            if (err) {
              return
            }
            const properties = json['e:propertyset']['e:property']
            let obj = {}
            for (const prop of properties) {
              for (const key in prop) {
                obj[key] = prop[key][0]
              }
            }
            accessory.emit(service, obj)
          })
        }
      }
      response.end()
    })
  })
  this.server.listen(this.port, this.host, () => {
    this.callbackUrl = 'http://' + this.server.address().address + ':' +
                       this.server.address().port + '/notify'
    this.log.debug('listening on %s', this.callbackUrl)
    return callback()
  })
}

ZpPlatform.prototype.findPlayers = function () {
  SonosModule.search({ timeout: this.searchTimeout }, (zp, model) => {
    const deviceProperties = new SonosModule.Services.DeviceProperties(zp.host, zp.port)
    const zoneGroupTopology = new SonosModule.Services.ZoneGroupTopology(zp.host, zp.port)
    const alarmClock = new SonosModule.Services.AlarmClock(zp.host, zp.port)
    zp.model = model
    deviceProperties.GetZoneAttributes({}, (err, attrs) => {
      if (err) {
        this.log.error('%s:%s: error %s', zp.host, zp.port, err)
      } else {
        zp.zone = attrs.CurrentZoneName
        // this.log.debug('%s: zone attrs %j', zp.zone, attrs)
        deviceProperties.GetZoneInfo({}, (err, info) => {
          if (err) {
            this.log.error('%s: error %s', zp.zone, err)
          } else {
            // this.log.debug('%s: info %j', zp.zone, info)
            zp.id = 'RINCON_' + info.MACAddress.replace(/:/g, '') +
                    ('00000' + zp.port).substr(-5, 5)
            zp.version = info.DisplaySoftwareVersion
            zoneGroupTopology.GetZoneGroupAttributes({}, (err, attrs) => {
              if (err) {
                this.log.error('%s: error %s', zp.zone, err)
              } else {
                // this.log.debug('%s: zone group attrs %j', zp.zone, attrs)
                if (attrs.CurrentZoneGroupID === '') {
                  this.log.debug(
                    '%s: ignore slave %s v%s player %s at %s:%s',
                    zp.zone, zp.model, zp.version, zp.id, zp.host, zp.port
                  )
                } else {
                  this.log.debug(
                    '%s: setup %s v%s player %s at %s:%s',
                    zp.zone, zp.model, zp.version, zp.id, zp.host, zp.port
                  )
                  zp.alarms = {}
                  if (this.alarms) {
                    alarmClock.ListAlarms((err, alarmClock) => {
                      if (err) {
                        this.log.error('%s: error %s', zp.zone, err)
                      } else {
                        for (const alarm of alarmClock.CurrentAlarmList) {
                          if (alarm && alarm.RoomUUID === zp.id) {
                            zp.alarms[alarm.ID] = alarm
                          }
                        }
                      }
                    })
                  }
                  this.players.push(zp)
                }
              }
            })
          }
        })
      }
    })
  })
}

// Return coordinator for group.
ZpPlatform.prototype.groupCoordinator = function (group) {
  for (const id in this.zpAccessories) {
    const accessory = this.zpAccessories[id]
    if (accessory.isCoordinator && accessory.group === group) {
      return accessory
    }
  }
  return null
}

// Return array of members for group.
ZpPlatform.prototype.groupMembers = function (group) {
  const members = []
  for (const id in this.zpAccessories) {
    const accessory = this.zpAccessories[id]
    if (accessory.coordinator !== accessory && accessory.group === group) {
      members.push(accessory)
    }
  }
  return members
}

ZpPlatform.prototype.onExit = function () {
  if (this.shuttingDown) {
    return
  }
  this.shuttingDown = true
  this.log.info('cleaning up...')
  for (const id in this.zpAccessories) {
    const accessory = this.zpAccessories[id]
    accessory.onExit()
  }
}
