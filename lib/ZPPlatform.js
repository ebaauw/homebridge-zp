// homebridge-zp/lib/ZPPlatform.js
// Copyright © 2016-2018 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.
//
// TODO:
// - Open session to found ZonePlayer and retrieve own address instead of
//   getting address from os.networkInterfaces().

'use strict'

const http = require('http')
const os = require('os')
const semver = require('semver')
const SonosModule = require('sonos')
const util = require('util')
const xml2js = require('xml2js')

const ZPAccessoryModule = require('./ZPAccessory')
const ZPAlarmModule = require('./ZPAlarm')
const ZPAccessory = ZPAccessoryModule.ZPAccessory
const packageJson = require('../package.json')

module.exports = {
  ZPPlatform: ZPPlatform,
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

// =======================================================================================
//
// Link platform module to Homebridge.

let Accessory
let Service
let Characteristic
let homebridgeVersion

function setHomebridge (homebridge) {
  // Link accessory modules to Homebridge.
  ZPAccessoryModule.setHomebridge(homebridge)
  ZPAlarmModule.setHomebridge(homebridge)

  Accessory = homebridge.platformAccessory
  Service = homebridge.hap.Service
  Characteristic = homebridge.hap.Characteristic
  homebridgeVersion = homebridge.serverVersion

  // Custom homekit characteristic for bass.
  Characteristic.Bass = function () {
    Characteristic.call(this, 'Bass', Characteristic.Bass.UUID)
    this.setProps({
      format: Characteristic.Formats.INT,
      minValue: -10,
      maxValue: 10,
      stepValue: 1,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY,
        Characteristic.Perms.WRITE]
    })
    this.value = this.getDefaultValue()
  }
  util.inherits(Characteristic.Bass, Characteristic)
  Characteristic.Bass.UUID = '00000041-0000-1000-8000-656261617577'

  // Custom homekit characteristic for treble.
  Characteristic.Treble = function () {
    Characteristic.call(this, 'Treble', Characteristic.Treble.UUID)
    this.setProps({
      format: Characteristic.Formats.INT,
      minValue: -10,
      maxValue: 10,
      stepValue: 1,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY,
        Characteristic.Perms.WRITE]
    })
    this.value = this.getDefaultValue()
  }
  util.inherits(Characteristic.Treble, Characteristic)
  Characteristic.Treble.UUID = '00000042-0000-1000-8000-656261617577'

  // Custom homekit characteristic for loudness.
  Characteristic.Loudness = function () {
    Characteristic.call(this, 'Loudness', Characteristic.Loudness.UUID)
    this.setProps({
      format: Characteristic.Formats.BOOL,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY,
        Characteristic.Perms.WRITE]
    })
    this.value = this.getDefaultValue()
  }
  util.inherits(Characteristic.Loudness, Characteristic)
  Characteristic.Loudness.UUID = '00000043-0000-1000-8000-656261617577'

  // Custom homekit characteristic for balance.
  Characteristic.Balance = function () {
    Characteristic.call(this, 'Balance', Characteristic.Treble.UUID)
    this.setProps({
      format: Characteristic.Formats.INT,
      minValue: -10,
      maxValue: 10,
      stepValue: 1,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY,
        Characteristic.Perms.WRITE]
    })
    this.value = this.getDefaultValue()
  }
  util.inherits(Characteristic.Balance, Characteristic)
  Characteristic.Balance.UUID = '00000044-0000-1000-8000-656261617577'

  // Custom homekit characteristic for name of current track.
  Characteristic.CurrentTrack = function () {
    Characteristic.call(this, 'Current Track', Characteristic.CurrentTrack.UUID)
    this.setProps({
      format: Characteristic.Formats.STRING,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
    })
    this.value = this.getDefaultValue()
  }
  util.inherits(Characteristic.CurrentTrack, Characteristic)
  Characteristic.CurrentTrack.UUID = '00000045-0000-1000-8000-656261617577'

  // Custom homekit characteristic for name of group coordinator.
  Characteristic.SonosGroup = function () {
    Characteristic.call(this, 'Sonos Group', Characteristic.SonosGroup.UUID)
    this.setProps({
      format: Characteristic.Formats.STRING,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
    })
    this.value = this.getDefaultValue()
  }
  util.inherits(Characteristic.SonosGroup, Characteristic)
  Characteristic.SonosGroup.UUID = '00000046-0000-1000-8000-656261617577'

  // Custom homekit characteristic for changing track.
  Characteristic.ChangeTrack = function () {
    Characteristic.call(this, 'Change Track', Characteristic.ChangeTrack.UUID)
    this.setProps({
      format: Characteristic.Formats.INT,
      minValue: -1,
      maxValue: 1,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY,
        Characteristic.Perms.WRITE]
    })
    this.value = this.getDefaultValue()
  }
  util.inherits(Characteristic.ChangeTrack, Characteristic)
  Characteristic.ChangeTrack.UUID = '00000047-0000-1000-8000-656261617577'

  // Custom homekit characteristic for enabled.
  // Source: homebride-hue.
  Characteristic.Enabled = function () {
    Characteristic.call(this, 'Enabled', Characteristic.Enabled.UUID)
    this.setProps({
      format: Characteristic.Formats.BOOL,
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY,
      	      Characteristic.Perms.WRITE]
    })
    this.value = this.getDefaultValue()
  }
  util.inherits(Characteristic.Enabled, Characteristic)
  Characteristic.Enabled.UUID = '00000022-0000-1000-8000-656261617577'

  // Custom homekit service for alarm.
  Service.Alarm = function (displayName, subtype) {
    Service.call(this, displayName, Service.Alarm.UUID, subtype)
    this.addCharacteristic(Characteristic.Enabled)
  }
  util.inherits(Service.Alarm, Service)
  Service.Alarm.UUID = '00000048-0000-1000-8000-656261617577'
}

// =======================================================================================

// Constructor for ZPPlatform.  Called by homebridge on load time.
function ZPPlatform (log, config) {
  this.log = log
  this.name = config.name || 'ZP'
  this.host = config.host || this.address()
  this.port = config.port || 0
  this.packageJson = packageJson
  switch (config.service) {
    case undefined:
      /* Falls through */
    case 'switch':
      this.service = Service.Switch
      this.characteristic = config.brightness ? Characteristic.Brightness : Characteristic.Volume
      break
    case 'light':
      this.service = Service.Lightbulb
      this.characteristic = Characteristic.Brightness
      break
    case 'speaker':
      this.service = Service.Speaker
      this.characteristic = config.brightness ? Characteristic.Brightness : Characteristic.Volume
      break
    case 'fan':
      this.service = Service.Fan
      this.characteristic = Characteristic.RotationSpeed
      break
    default:
      this.log.error('config.json: warning: ignoring unknown service \'%s\'', config.service)
      this.service = Service.Switch
      this.characteristic = Characteristic.Volume
      break
  }
  this.speakers = config.speakers || false
  this.alarms = config.alarms || false
  this.searchTimeout = config.searchTimeout || 2			          // seconds
  this.searchTimeout *= 1000						                        // milliseconds
  this.subscriptionTimeout = config.subscriptionTimeout || 30  // minutes
  this.subscriptionTimeout *= 60					                      // seconds

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

  this.listen(function () {
    this.findPlayers()
  }.bind(this))
}

// Return first non-loopback IPv4 address.
ZPPlatform.prototype.address = function () {
  const interfaces = os.networkInterfaces()
  for (const id in interfaces) {
    const aliases = interfaces[id]
    for (const aid in aliases) {
      const alias = aliases[aid]
      if (alias.family === 'IPv4' && alias.internal === false) {
        return alias.address
      }
    }
  }
  return '0.0.0.0'
}

// Called by homebridge to retrieve static list of ZPAccessories.
ZPPlatform.prototype.accessories = function (callback) {
  let accessoryList = []
  // Allow for search to find all Sonos ZonePlayers.
  setTimeout(function () {
    for (const zp of this.players) {
      const accessory = new ZPAccessory(this, zp)
      this.zpAccessories[zp.id] = accessory
      accessoryList.push(accessory)
    }
    return callback(accessoryList)
  }.bind(this), this.searchTimeout)
}

// Create listener to receive notifications from Sonos ZonePlayers.
ZPPlatform.prototype.listen = function (callback) {
  this.server = http.createServer(function (request, response) {
    let buffer = ''
    request.on('data', function (data) {
      buffer += data
    })
    request.on('end', function () {
      request.body = buffer
      // this.log.debug('listener: %s %s', request.method, request.url);
      if (request.method === 'GET' && request.url === '/notify') {
        // Provide an easy way to check that listener is reachable.
        response.writeHead(200, {'Content-Type': 'text/plain'})
        response.write(this.infoMessage)
      } else if (request.method === 'NOTIFY') {
        const array = request.url.split('/')
        const accessory = this.zpAccessories[array[2]]
        const service = array[3]
        if (array[1] === 'notify' && accessory !== null && service !== null) {
          this.parser.parseString(request.body.toString(), function (error, json) {
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
    }.bind(this))
  }.bind(this))
  this.server.listen(this.port, this.host, function () {
    this.callbackUrl = 'http://' + this.server.address().address + ':' +
                       this.server.address().port + '/notify'
    this.log.debug('listening on %s', this.callbackUrl)
    return callback()
  }.bind(this))
}

ZPPlatform.prototype.findPlayers = function () {
  SonosModule.search({timeout: this.searchTimeout}, function (zp, model) {
    const deviceProperties = new SonosModule.Services.DeviceProperties(zp.host, zp.port)
    const zoneGroupTopology = new SonosModule.Services.ZoneGroupTopology(zp.host, zp.port)
    const alarmClock = new SonosModule.Services.AlarmClock(zp.host, zp.port)
    zp.model = model
    deviceProperties.GetZoneAttributes({}, function (err, attrs) {
      if (err) {
        this.log.error('%s:%s: error %s', zp.host, zp.port, err)
      } else {
        zp.zone = attrs.CurrentZoneName
        // this.log.debug('%s: zone attrs %j', zp.zone, attrs);
        deviceProperties.GetZoneInfo({}, function (err, info) {
          if (err) {
            this.log.error('%s: error %s', zp.zone, err)
          } else {
            // this.log.debug('%s: info %j', zp.zone, info);
            zp.id = 'RINCON_' + info.MACAddress.replace(/:/g, '') +
                    ('00000' + zp.port).substr(-5, 5)
            zp.version = info.DisplaySoftwareVersion
            zoneGroupTopology.GetZoneGroupAttributes({}, function (err, attrs) {
              if (err) {
                this.log.error('%s: error %s', zp.zone, err)
              } else {
                // this.log.debug('%s: zone group attrs %j', zp.zone, attrs);
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
                    alarmClock.ListAlarms(function (err, alarmClock) {
                      if (err) {
                        this.log.error('%s: error %s', zp.zone, err)
                      } else {
                        for (const alarm of alarmClock.CurrentAlarmList) {
                          if (alarm && alarm.RoomUUID === zp.id) {
                            zp.alarms[alarm.ID] = alarm
                          }
                        }
                      }
                    }.bind(this))
                  }
                  this.players.push(zp)
                }
              }
            }.bind(this))
          }
        }.bind(this))
      }
    }.bind(this))
  }.bind(this))
}

// Return coordinator for group.
ZPPlatform.prototype.groupCoordinator = function (group) {
  for (const id in this.zpAccessories) {
    const accessory = this.zpAccessories[id]
    if (accessory.isCoordinator && accessory.group === group) {
      return accessory
    }
  }
  return null
}

// Return array of members for group.
ZPPlatform.prototype.groupMembers = function (group) {
  const members = []
  for (const id in this.zpAccessories) {
    const accessory = this.zpAccessories[id]
    if (accessory.coordinator !== accessory && accessory.group === group) {
      members.push(accessory)
    }
  }
  return members
}
