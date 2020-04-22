// homebridge-zp/lib/ZpPlatform.js
// Copyright © 2016-2020 Erik Baauw. All rights reserved.
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
    if (configJson == null) {
      return
    }
    this.on('accessoryRestored', this.accessoryRestored)
    this.parseConfigJson(configJson)
    this.unInitialisedZpClients = 0
    this.zpClients = {} // ZpClient by id.
    this.zpMasters = {} // ZpAccessory.Master delegates by zoneplayer id.
    this.zpSlaves = {} // ZpAccessory.Slave delegates by zonePlayer id.
    this.zpTvs = {} // ZpAccessory.Tv delegates by zonePlayer id.

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
    this.zpListener = new ZpListener(this.config.port, this.config.address)
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

  // Parse config.json into this.config.
  parseConfigJson (configJson) {
    this.config = {
      nameScheme: '% Sonos',
      port: 0,
      resetTimeout: 500, // milliseconds
      subscriptionTimeout: 30, // minutes
      timeout: 15, // seconds
      tvIdPrefix: 'TV',
      SpeakerService: this.Services.hap.Switch,
      VolumeCharacteristic: this.Characteristics.hap.Volume
    }
    const optionParser = new homebridgeLib.OptionParser(this.config, true)
    optionParser.on('userInputError', (message) => {
      this.warn('config.json: %s', message)
    })
    optionParser.stringKey('platform')
    optionParser.stringKey('name')
    optionParser.stringKey('address')
    optionParser.boolKey('alarms')
    optionParser.boolKey('brightness')
    optionParser.boolKey('excludeAirPlay')
    optionParser.intKey('heartrate', 1, 60)
    optionParser.boolKey('leds')
    optionParser.stringKey('nameScheme')
    optionParser.intKey('port', 0, 65535)
    optionParser.intKey('resetTimeout', 1, 60)
    optionParser.enumKey('service')
    optionParser.enumKeyValue('service', 'fan', (value) => {
      this.config.SpeakerService = this.Services.hap.Fan
      this.config.VolumeCharacteristic = this.Characteristics.hap.RotationSpeed
      this.Characteristics.hap.SwingMode

    })
    optionParser.enumKeyValue('service', 'light', (value) => {
      this.config.SpeakerService = this.Services.hap.Lightbulb
      this.config.VolumeCharacteristic = this.Characteristics.hap.Brightness
    })
    optionParser.enumKeyValue('service', 'speaker', (value) => {
      this.config.SpeakerService = this.Services.hap.Speaker
      this.config.VolumeCharacteristic = this.Characteristics.hap.Volume
    })
    optionParser.enumKeyValue('service', 'switch', (value) => {
      this.config.SpeakerService = this.Services.hap.Switch
      this.config.VolumeCharacteristic = this.Characteristics.hap.Volume
    })
    optionParser.boolKey('speakers')
    optionParser.intKey('subscriptionTimeout', 1, 1440) // minutes
    optionParser.intKey('timeout', 1, 60) // seconds
    optionParser.boolKey('tv')
    optionParser.stringKey('tvIdPrefix', true)
    try {
      optionParser.parse(configJson)
      if (this.config.port <= 1024) {
        this.config.port = 0
      }
      if (this.config.brightness) {
        if (this.config.service === 'speaker' || this.config.service === 'switch') {
          this.config.VolumeCharacteristic = this.Characteristics.hap.Brightness
        } else {
          this.warn(
            'config.json: ignoring "brightness" for "service": "%s"',
            this.config.service
          )
        }
      }
      this.config.subscriptionTimeout *= 60 // minutes -> seconds
    } catch (error) {
      this.fatal(error)
    }
  }

  heartbeat (beat) {
    if (beat % 300 === 30) {
      if (this.associatedZpClient == null) {
        this.warn('no zone players found')
        return
      }
      for (const id in this.associatedZpClient.zonePlayers) {
        const zpClient = this.zpClients[id]
        if (zpClient == null || !zpClient.initialised) {
          continue
        }
        if (zpClient.lastSeen == null) {
          this.lostPlayer(zpClient.id, zpClient.zoneName)
          continue
        }
        const log = (zpClient.lastSeen > 570 ? this.log : this.debug).bind(this)
        log(
          '%s [%s]: lastSeen: %js ago at %s, bootSeq: %j', zpClient.id,
          zpClient.name, zpClient.lastSeen, zpClient.address, zpClient.bootSeq
        )
        // if (zpClient.lastSeen > 600) {
        //   this.lostPlayer(zpClient.id, zpClient.zoneName)
        // }
      }
    }
  }

  accessoryRestored (className, version, id, name, context) {
    if (context.address != null) {
      this.createZpClient(id, context.address).catch((error) => {
        this.error(error)
      })
    }
  }

  async handleUpnpMessage (address, message) {
    const id = message.usn.split(':')[1]
    if (message.st != null) {
      this.debug('upnp: found %s at %s', id, address)
    } else {
      // this.debug('upnp: %s is alive at %s', id, address)
    }
    try {
      await this.createZpClient(id, address)
      this.zpClients[id].handleUpnpMessage(address, message)
    } catch (error) {
      this.error(error)
    }
  }

  // Create new zpClient.
  async createZpClient (id, address) {
    let zpClient = this.zpClients[id]
    if (this.zpClients[id] == null) {
      zpClient = new ZpClient({
        host: address,
        id: id,
        timeout: this.config.timeout
      })
      zpClient.initialised = false
      this.zpClients[id] = zpClient
      zpClient.on('request', (id, method, url, action) => {
        this.debug(
          '%s [%s]: request %s: %s %s%s', zpClient.id,
          zpClient.name == null ? zpClient.address : zpClient.name,
          id, method, url,
          action == null ? '' : ' ' + action
        )
      })
      zpClient.on('response', (id, statusCode, statusMessage) => {
        this.debug(
          '%s [%s]: request %s: status %d %s', zpClient.id,
          zpClient.name == null ? zpClient.address : zpClient.name,
          id, statusCode, statusMessage
        )
      })
      zpClient.on('event', (device, service, payload) => {
        this.debug(
          '%s [%s]: event: NOTIFY %s/Event', zpClient.id,
          zpClient.name == null ? zpClient.address : zpClient.name,
          device === 'ZonePlayer' ? service : device + '/' + service
        )
        const f = `handle${device}${service}Event`
        if (this[f] != null) {
          this[f](zpClient, payload)
        }
      })
      zpClient.on('error', (error) => {
        this.error(
          '%s [%s]: %s', zpClient.id,
          zpClient.name == null ? zpClient.address : zpClient.name,
          error
        )
      })
      zpClient.on('rebooted', (bootSeq) => {
        this.warn(
          '%s [%s]: rebooted %j -> %j', zpClient.id,
          zpClient.name == null ? zpClient.address : zpClient.name,
          bootSeq, zpClient.bootSeq
        )
      })
      zpClient.on('addressChanged', (oldAddress) => {
        this.warn(
          '%s [%s]: now at %s', zpClient.id,
          zpClient.name == null ? oldAddress : zpClient.name,
          zpClient.address
        )
      })
    }
    if (!zpClient.initialised) {
      if (zpClient.initialising) {
        await events.once(zpClient, 'init')
        if (zpClient.name == null) {
          this.error(
            '%s [%s]: cannot initialise zone player',
            zpClient.id, zpClient.address
          )
        }
        return zpClient
      }
      try {
        zpClient.initialising = true
        this.unInitialisedZpClients++
        this.debug(
          '%s [%s]: probing (%d jobs)...',
          id, address, this.unInitialisedZpClients
        )
        await zpClient.init()
        this.debug(
          '%s [%s]: %s: %s (%s) v%s', id, address, zpClient.name,
          zpClient.modelName, zpClient.modelNumber, zpClient.version
        )
        this.topologyChanged = true
        await this.parseZones(zpClient)
        await zpClient.open(this.zpListener)
        if (this.associatedZpClient == null && !zpClient.invisible) {
          this.associatedZpClient = zpClient
          this.log(
            '%s [%s]: associated zone player', zpClient.id, zpClient.name
          )
          await zpClient.subscribe('/ZoneGroupTopology/Event')
        }
        zpClient.initialised = true
        this.unInitialisedZpClients--
        this.debug(
          '%s [%s]: probing done (%d jobs remaining)',
          zpClient.id, zpClient.name, this.unInitialisedZpClients
        )
        zpClient.emit('init')
      } catch (error) {
        this.error('%s [%s]: %s', id, address, error)
        this.unInitialisedZpClients--
        this.debug(
          '%s [%s]: probing failed (%d jobs remaining)', id, address,
          this.unInitialisedZpClients
        )
      }
      delete zpClient.initialising
      zpClient.emit('init')
      if (this.unInitialisedZpClients === 0 && this.topologyChanged) {
        this.topologyChanged = false
        this.logTopology()
      }
    }
    return zpClient
  }

  async parseZones (zpClient) {
    const jobs = []
    for (const id in zpClient.zonePlayers) {
      if (this.zpClients[id] == null) {
        const zonePlayer = zpClient.zonePlayers[id]
        if (zonePlayer == null) {
          continue
        }
        jobs.push(
          this.createZpClient(zonePlayer.id, zonePlayer.address)
            .catch((error) => {
              this.error('%s [%s]: %s', zonePlayer.id, zonePlayer.address, error)
            })
        )
      }
    }
    for (const job of jobs) {
      await job
    }
  }

  lostPlayer (id, zoneName) {
    const zpClient = this.zpClients[id]
    if (zpClient == null) {
      return
    }
    this.debug('%s: %s vanished from %s', zpClient.name, zpClient.id, zoneName)
    zpClient.initialised = false
    this.topologyChanged = true
    zpClient.close().catch((error) => {
      this.error('%s [%s]: %s', zpClient.id, zpClient.address, error)
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

  async logTopology () {
    if (this.associatedZpClient == null) {
      this.warn('no zone players found')
      this.debug('initialised')
      this.emit('initialised')
      return
    }
    const zonePlayers = this.associatedZpClient.zonePlayers
    for (const id in zonePlayers) {
      if (this.zpClients[id] == null || !this.zpClients[id].initialised) {
        delete zonePlayers[id]
      }
    }
    const zones = ZpClient.unflatten(zonePlayers)
    const nZones = Object.keys(zones).length
    this.log(
      'found %d zone players in %d zones',
      Object.keys(zonePlayers).length, nZones
    )
    let i = 0
    let j = 0
    let nZonePlayers
    for (const id in zonePlayers) {
      const zpClient = this.zpClients[id]
      if (zpClient.role === 'master') {
        i++
        j = 0
        let caps = ''
        if (zpClient.invisible) {
          // Sonos Boost or Sonos Bridge
          caps = ' (invisible)'
        }
        this.log(
          '%s %s%s', i < nZones ? '├─' : '└─',
          zpClient.zoneDisplayName, caps
        )
        nZonePlayers = 1
        nZonePlayers += zpClient.slaves != null ? zpClient.slaves.length : 0
        // Fixme: handle missing satellites
        nZonePlayers += zpClient.satellites != null
          ? zpClient.satellites.length : 0
      }
      j++
      let caps = zpClient.role
      caps += zpClient.airPlay ? ', airPlay' : ''
      caps += zpClient.audioIn ? ', audioIn' : ''
      caps += zpClient.tvIn ? ', tvIn' : ''
      this.log(
        '%s %s %s [%s]: %s (%s) (%s)', i < nZones ? '│ ' : '  ',
        j < nZonePlayers ? '├─' : '└─', zpClient.id,
        zpClient.name, zpClient.modelName, zpClient.modelNumber, caps
      )
    }
    const jobs = []
    for (const id in zonePlayers) {
      const zpClient = this.zpClients[id]
      const a = zpClient.modelName.split(' ')
      const params = {
        // name: this.config.nameScheme.replace('%', zonePlayer.zoneName),
        name: zpClient.zoneName,
        id: zpClient.id,
        zpClient: zpClient,
        address: zpClient.address,
        manufacturer: a[0],
        model: a[1] + ' (' + zpClient.modelNumber + ')',
        firmware: zpClient.version
      }
      if (zpClient.channel != null && zpClient.channel !== '') {
        params.name += ' ' + zpClient.channel
      }
      const expose = !(this.config.excludeAirPlay && zpClient.airPlay) &&
        !zpClient.invisible
      if (zpClient.role === 'master') {
        if (expose && this.zpMasters[zpClient.id] == null) {
          this.zpMasters[zpClient.id] = new ZpAccessory.Master(this, params)
          jobs.push(events.once(this.zpMasters[zpClient.id], 'initialised'))
        }
        if (expose && this.config.tv && this.zpTvs[zpClient.id] == null) {
          const tvParams = Object.assign({
            master: this.zpMasters[zpClient.id]
          }, params)
          this.zpTvs[zpClient.id] = new ZpAccessory.Tv(this, tvParams)
          jobs.push(events.once(this.zpTvs[zpClient.id], 'initialised'))
        }
      } else { // zonePlayer.role != 'master'
        if (this.config.leds && this.zpSlaves[zpClient.id] == null) {
          this.zpSlaves[zpClient.id] = new ZpAccessory.Slave(this, params)
          jobs.push(events.once(this.zpSlaves[zpClient.id], 'initialised'))
        }
      }
    }
    for (const job of jobs) {
      await job
    }
    this.debug('initialised')
    this.emit('initialised')
  }

  // Return coordinator for group.
  groupCoordinator (groupId) {
    for (const id in this.zpMasters) {
      const accessory = this.zpMasters[id]
      if (accessory.isCoordinator && accessory.groupId === groupId) {
        return accessory
      }
    }
    return null
  }

  // Return array of members for group.
  groupMembers (groupId) {
    const members = []
    for (const id in this.zpMasters) {
      const accessory = this.zpMasters[id]
      if (!accessory.isCoordinator && accessory.groupId === groupId) {
        members.push(accessory)
      }
    }
    return members
  }

  // Set coordinator zpAccessory as default coordinator
  setPlatformCoordinator (coordinator) {
    this.coordinator = coordinator
    for (const id in this.zpMasters) {
      const accessory = this.zpMasters[id]
      const service = accessory.sonosService
      if (service != null) {
        service.values.sonosCoordinator = accessory === coordinator
        service.values.platformCoordinatorId = coordinator.zpClient.id
      }
    }
  }
}

module.exports = ZpPlatform
