// homebridge-zp/lib/ZpPlatform.js
// Copyright © 2016-2019 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

const events = require('events')
const homebridgeLib = require('homebridge-lib')
const ZpAccessory = require('./ZpAccessory')
const ZpClient = require('./ZpClient')
const ZpListener = require('./ZpListener')

// Constructor for ZpPlatform.  Called by homebridge on load time.
class ZpPlatform extends homebridgeLib.Platform {
  constructor (log, configJson, homebridge) {
    super(log, configJson, homebridge)
    this.on('accessoryRestored', this.accessoryRestored)
    if (configJson == null) {
      return
    }
    this.parseConfigJson(configJson)
    this.unInitialisedZpClients = 0
    this.zpAccessories = {} // ZpAccessory by id of master.
    this.zpClients = {} // ZpClient by id.
    this.zonePlayers = {} // Reachable ZonePlayers by id.
    this.zones = {} // Reachable zone by zoneName.

    // this.once('heartbeat', this.init)
    this.on('heartbeat', this.heartbeat)
    this.on('shutdown', async () => {
      for (const id in this.zpClients) {
        try {
          await this.zpClients[id].close()
        } catch (error) {
          this.log(error)
        }
      }
    })

    this.upnpConfig({ class: 'urn:schemas-upnp-org:device:ZonePlayer:1' })
    this.on('upnpDeviceAlive', this.handleUpnpMessage)
    this.on('upnpDeviceFound', this.handleUpnpMessage)

    // Setup listener for zoneplayer events.
    this.zpListener = new ZpListener()
    this.zpListener.on('listening', (url) => {
      this.log('listening on %s', url)
    })
    this.zpListener.on('close', (url) => {
      this.log('closed %s', url)
    })
    this.zpListener.on('error', (error) => { this.error(error) })

    const jsonOptions = { noWhiteSpace: false, sortKeys: true }
    this.jsonFormatter = new homebridgeLib.JsonFormatter(jsonOptions)

    this.debug('config: %j', this.config)
    this.debug('SpeakerService: %j', this.config.SpeakerService.UUID)
    this.debug('VolumeCharacteristic: %j', this.config.VolumeCharacteristic.UUID)
  }

  // Reachable ZonePlayers by zonePlayerName
  get zonePlayersByName () {
    const zonePlayersByName = {}
    for (const id in this.zonePlayers) {
      const zonePlayer = this.zonePlayers[id]
      zonePlayersByName[zonePlayer.name] = zonePlayer
    }
    return zonePlayersByName
  }

  // get zones () {
  //   const zonesByName = {}
  //   for (const id in this.zonePlayers) {
  //     const zonePlayer = this.zonePlayers[id]
  //     if (zonePlayer.role === 'master') {
  //       zonesByName[zonePlayer.zoneName] = zonePlayer
  //     }
  //   }
  //   return zonesByName
  // }

  // get zonesByName () {
  //   const zonesByName = {}
  //   for (const id in this.zones) {
  //     const zone = this.zones[id]
  //     zonesByName[zone.name] = zone
  //   }
  //   return zonesByName
  // }

  // Parse config.json into this.config.
  parseConfigJson (configJson) {
    this.config = {
      host: '0.0.0.0',
      nameScheme: '% Sonos',
      port: 0,
      resetTimeout: 500, // milliseconds
      searchTimeout: 15, // seconds
      subscriptionTimeout: 30, // minutes
      timeout: 15, // seconds
      SpeakerService: this.Service.hap.Switch,
      VolumeCharacteristic: this.Characteristic.hap.Volume
    }
    const optionParser = new homebridgeLib.OptionParser(this.config, true)
    optionParser.on('usageError', (message) => {
      this.warn('config.json: %s', message)
    })
    optionParser.stringKey('platform')
    optionParser.stringKey('name')
    optionParser.boolKey('alarms')
    optionParser.boolKey('brightness')
    optionParser.boolKey('excludeAirPlay')
    optionParser.intKey('heartrate', 1, 60)
    optionParser.stringKey('host')
    optionParser.boolKey('leds')
    optionParser.stringKey('nameScheme')
    optionParser.intKey('port', 1, 65535)
    optionParser.intKey('resetTimeout', 1, 60)
    optionParser.intKey('searchTimeout', 1, 60)
    optionParser.enumKey('service')
    optionParser.enumKeyValue('service', 'fan', (value) => {
      this.config.SpeakerService = this.Service.hap.Fan
      this.config.VolumeCharacteristic = this.Characteristic.hap.RotationSpeed
    })
    optionParser.enumKeyValue('service', 'light', (value) => {
      this.config.SpeakerService = this.Service.hap.Lightbulb
      this.config.VolumeCharacteristic = this.Characteristic.hap.Brightness
    })
    optionParser.enumKeyValue('service', 'speaker', (value) => {
      this.config.SpeakerService = this.Service.hap.Speaker
      this.config.VolumeCharacteristic = this.Characteristic.hap.Volume
    })
    optionParser.enumKeyValue('service', 'switch', (value) => {
      this.config.SpeakerService = this.Service.hap.Switch
      this.config.VolumeCharacteristic = this.Characteristic.hap.Volume
    })
    optionParser.boolKey('speakers')
    optionParser.intKey('subscriptionTimeout', 1, 1440) // minutes
    optionParser.intKey('timeout', 1, 60) // seconds
    optionParser.boolKey('tv')
    try {
      optionParser.parse(configJson)
      if (this.config.brightness) {
        if (this.config.service === 'speaker' && this.config.service === 'switch') {
          this.config.VolumeCharacteristic = this.Characteristic.hap.Brightness
        } else {
          this.warn(
            'config.json: ignoring "brightness" for "service": "%s"',
            this.config.service
          )
        }
      }
      this.config.searchTimeout *= 1000 // seconds -> milliseconds
      this.config.subscriptionTimeout *= 60 // minutes -> seconds
    } catch (error) {
      this.fatal(error)
    }
  }

  // init (beat) {
  //   this.debug('config: %j', this.config)
  //   this.debug('SpeakerService: %j', this.config.SpeakerService.UUID)
  //   this.debug('VolumeCharacteristic: %j', this.config.VolumeCharacteristic.UUID)
  // }

  heartbeat (beat) {
    if (beat % 60 === 30) {
      for (const zonePlayerName of Object.keys(this.zonePlayersByName).sort()) {
        const zpClient = this.zonePlayersByName[zonePlayerName]
        if (zpClient.lastSeen == null) {
          this.lostPlayer(zpClient.id, zpClient.zoneName)
          continue
        }
        const log = (zpClient.lastSeen > 570 ? this.log : this.debug).bind(this)
        log(
          '%s: lastSeen: %js ago at %s, bootSeq: %j', zpClient.name,
          zpClient.lastSeen, zpClient.address, zpClient.bootSeq
        )
        // if (zpClient.lastSeen > 600) {
        //   this.lostPlayer(zpClient.id, zpClient.zoneName)
        // }
      }
    }
  }

  accessoryRestored (className, version, id, name, context) {
    this.createZpClient(context.address, id).catch((error) => {
      this.error(error)
    })
  }

  async handleUpnpMessage (address, message) {
    const id = message.usn.split(':')[1]
    if (message.st != null) {
      this.debug('upnp: found %s at %s', id, address)
    } else {
      // this.debug('upnp: %s is alive at %s', id, address)
    }
    try {
      await this.createZpClient(address, id)
      this.zpClients[id].handleUpnpMessage(address, message)
    } catch (error) {
      this.error(error)
    }
  }

  // Create new zpClient.
  async createZpClient (address, id) {
    let zpClient = this.zpClients[id]
    if (this.zpClients[id] == null) {
      zpClient = new ZpClient({
        host: address,
        id: id,
        timeout: this.config.timeout
      })
      zpClient.initialised = false
      this.zpClients[id] = zpClient
      zpClient.on('error', (error) => {
        this.error('%s: %s', zpClient.address, error.message)
      })
      zpClient.on('rebooted', (bootSeq) => {
        this.warn(
          '%s: rebooted %j -> %j', zpClient.address, bootSeq, zpClient.bootSeq
        )
      })
      zpClient.on('addressChanged', (oldAddress) => {
        this.warn('%s: now at %s', oldAddress, zpClient.address)
      })
      zpClient.on('event', (device, service, payload) => {
        const f = `handle${device}${service}Event`
        if (this[f] != null) {
          this.debug('%s: %s event', address, service)
          // this.debug('%s: %s event: %j', address, service, payload)
          this[f](zpClient, payload)
        }
      })
    }
    if (!zpClient.initialised) {
      if (zpClient.initialising) {
        await events.once(zpClient, 'init')
        if (zpClient.name == null) {
          throw new Error('cannot initialise zone player')
        }
        return zpClient
      }
      try {
        zpClient.initialising = true
        this.unInitialisedZpClients++
        this.debug('%s: %s: probing (%d jobs)...', address, id, this.unInitialisedZpClients)
        await zpClient.init()
        this.debug(
          '%s: %s: %s: %s (%s) v%s', address, id, zpClient.name,
          zpClient.modelName, zpClient.modelNumber, zpClient.version
        )
        if (this.zonePlayers[zpClient.id] == null) {
          this.topologyChanged = true
          this.zonePlayers[zpClient.id] = zpClient
        }
        if (this.zones[zpClient.zoneName] == null) {
          this.topologyChanged = true
          this.zones[zpClient.zoneName] = {
            master: zpClient.role === 'master' ? zpClient.name : null,
            name: zpClient.zoneName,
            zonePlayers: {}
          }
        }
        if (
          zpClient.role === 'master' &&
          this.zones[zpClient.zoneName].master !== zpClient.id
        ) {
          this.topologyChanged = true
          this.zones[zpClient.zoneName].master = zpClient.name
        }
        if (this.zones[zpClient.zoneName].zonePlayers[zpClient.name] == null) {
          this.topologyChanged = true
          this.zones[zpClient.zoneName].zonePlayers[zpClient.name] = zpClient
        }
        await this.parseZones(zpClient.zones, zpClient.name)
        await zpClient.open(this.zpListener)
        await zpClient.subscribe('/ZoneGroupTopology/Event')
        zpClient.initialised = true
        delete zpClient.initialising
        this.unInitialisedZpClients--
        this.debug(
          '%s: %s: probing done (%d jobs remaining)', address, id,
          this.unInitialisedZpClients
        )
        zpClient.emit('init')
      } catch (error) {
        this.error(error)
        delete zpClient.initialising
        this.unInitialisedZpClients--
        this.debug(
          '%s: %s: probing failed (%d jobs remaining)', address, id,
          this.unInitialisedZpClients
        )
        zpClient.emit('init')
        throw error
      }
    }
    return zpClient
  }

  async parseZones (zones) {
    const jobs = []
    for (const zoneName in zones) {
      const zone = zones[zoneName]
      for (const zonePlayerName in zone.zonePlayers) {
        const zonePlayer = zone.zonePlayers[zonePlayerName]
        if (this.zpClients[zonePlayer.id] == null) {
          jobs.push(
            this.createZpClient(zonePlayer.address, zonePlayer.id)
              .catch((error) => {
                this.error('%s: %j', zonePlayer.address, error)
              })
          )
        }
      }
    }
    for (const job of jobs) {
      await job
    }
    if (this.unInitialisedZpClients === 0 && this.topologyChanged) {
      this.topologyChanged = false
      this.logTopology()
    }
  }

  lostPlayer (id, zoneName) {
    const zpClient = this.zpClients[id]
    if (zpClient == null || this.zonePlayers[id] == null) {
      return
    }
    const zonePlayerName = zpClient.name
    this.debug('%s: %s vanished from %s', zonePlayerName, zpClient.id, zoneName)
    if (this.zones[zoneName] != null) {
      delete this.zones[zoneName].zonePlayers[zonePlayerName]
      if (Object.keys(this.zones[zoneName].zonePlayers).length === 0) {
        this.debug('%s: vanished', zoneName)
        delete this.zones[zoneName]
      }
    }
    delete this.zonePlayers[id]
    zpClient.close().catch((error) => {
      this.error('%s: %s', zpClient.address, error)
    })
    this.logTopology()
  }

  handleZonePlayerZoneGroupTopologyEvent (zpClient, zoneGroupState) {
    if (zoneGroupState.vanishedDevices != null) {
      for (const zonePlayer of zoneGroupState.vanishedDevices) {
        this.lostPlayer(zonePlayer.uuid, zonePlayer.zoneName)
      }
    }
    if (zoneGroupState.zoneGroups != null) {
      this.parseZones(zoneGroupState.zoneGroups).catch((error) => {
        this.error(error)
      })
    }
  }

  logTopology () {
    this.log('found %d zones', Object.keys(this.zones).length)
    for (const zoneName of Object.keys(this.zones).sort()) {
      const zone = this.zones[zoneName]
      const master = zone.zonePlayers[zone.master]
      this.log(
        '  %s:%s zone', zone.name,
        master.homeTheatre ? ' home theatre'
          : master.stereoPair ? ' stereo pair' : ''
      )
    }
    this.log('found %d zone players', Object.keys(this.zonePlayers).length)
    for (const zonePlayerName of Object.keys(this.zonePlayersByName).sort()) {
      const zonePlayer = this.zonePlayersByName[zonePlayerName]
      let caps = zonePlayer.role
      caps += zonePlayer.airPlay ? ', airPlay' : ''
      caps += zonePlayer.audioIn ? ', audioIn' : ''
      caps += zonePlayer.tvIn ? ', tvIn' : ''
      this.log(
        '  %s: %s (%s) (%s)', zonePlayer.name,
        zonePlayer.modelName, zonePlayer.modelNumber, caps
      )
    }
    for (const zoneName of Object.keys(this.zones).sort()) {
      const zone = this.zones[zoneName]
      const master = zone.zonePlayers[zone.master]
      if (this.zpAccessories[master.id] == null) {
        const a = master.modelName.split(' ')
        const params = {
          name: this.config.nameScheme.replace('%', master.zoneName),
          id: master.id,
          address: master.address,
          manufacturer: a[0],
          model: a[1] + ' (' + master.modelNumber + ')',
          firmware: master.version,
          category: this.Accessory.hap.Categories.SPEAKER
        }
        this.zpAccessories[master.id] = new ZpAccessory(this, params)
      }
      for (const zonePlayerName of Object.keys(zone.zonePlayers).sort()) {
        const slave = zone.zonePlayers[zonePlayerName]
        if (slave.role === 'master') {
          continue
        }
        this.zpAccessories[master.id]
          .addLedService(this.zpClients[slave.id])
      }
    }
  }

  // Return coordinator for group.
  groupCoordinator (groupId) {
    for (const id in this.zpAccessories) {
      const accessory = this.zpAccessories[id]
      if (accessory.isCoordinator && accessory.groupId === groupId) {
        return accessory
      }
    }
    return null
  }

  // Return array of members for group.
  groupMembers (groupId) {
    const members = []
    for (const id in this.zpAccessories) {
      const accessory = this.zpAccessories[id]
      // if (accessory.coordinator !== accessory && accessory.groupId === groupId) {
      if (!accessory.isCoordinator && accessory.groupId === groupId) {
        members.push(accessory)
      }
    }
    return members
  }

  // Set coordinator zpAccessory as default coordinator
  setPlatformCoordinator (coordinator) {
    this.coordinator = coordinator
    for (const id in this.zpAccessories) {
      const accessory = this.zpAccessories[id]
      const service = accessory.sonosService
      if (service != null) {
        service.values.sonosCoordinator = accessory === coordinator
      }
    }
  }
}

module.exports = ZpPlatform
