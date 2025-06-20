// homebridge-zp/lib/ZpPlatform.js
// Copyright © 2016-2025 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

import { once } from 'node:events'

import { Bonjour } from 'homebridge-lib/Bonjour'
import { OptionParser } from 'homebridge-lib/OptionParser'
import { Platform } from 'homebridge-lib/Platform'
import { ZpClient } from 'hb-zp-tools/ZpClient'
import { ZpListener } from 'hb-zp-tools/ZpListener'

import { ZpAccessory } from './ZpAccessory/index.js'
import './ZpAccessory/Master.js'
import { ZpHousehold } from './ZpHousehold.js'
import { ZpService } from './ZpService/index.js'
import './ZpService/Sonos.js'

// Constructor for ZpPlatform.  Called by homebridge on load time.
class ZpPlatform extends Platform {
  constructor (log, configJson, homebridge) {
    super(log, configJson, homebridge)
    this.parseConfigJson(configJson)
    this.unInitialisedZpClients = 0
    this.households = {} // Households by household id.
    this.zpClients = {} // ZpClient by zoneplayer id.
    this.zpMasters = {} // ZpAccessory.Master delegates by zoneplayer id.
    this.zpSlaves = {} // ZpAccessory.Slave delegates by zonePlayer id.
    this.zpTvs = {} // ZpAccessory.Tv delegates by zonePlayer id.
    this.coordinators = {} // ZpAccessory.Master coordinator per household id.
    this.staleAccessories = {}

    this
      .on('accessoryRestored', this.accessoryRestored)
      .on('heartbeat', this.heartbeat)
      .on('shutdown', async () => {
        for (const id in this.zpClients) {
          try {
            await this.zpClients[id].close()
          } catch (error) { this.error(error) }
        }
      })

    // Setup listener for mDNS announcements.
    if (this.config.mdns) {
      this.bonjour = new Bonjour()
      this.browser = this.bonjour.find({ type: 'sonos' })
      this.browser.on('up', (message) => { this.handleMdnsMessage(message) })
    }

    // Setup listener for UPnP announcements.
    this.upnpConfig({ class: 'urn:schemas-upnp-org:device:ZonePlayer:1' })
    this
      .on('upnpDeviceAlive', this.handleUpnpMessage)
      .on('upnpDeviceFound', this.handleUpnpMessage)

    // Setup listener for zoneplayer events.
    this.listener = new ZpListener(this.config.port)
    this.listener
      .on('listening', (url) => { this.log('listening on %s', url) })
      .on('close', (url) => { this.log('closed %s', url) })
      .on('error', (error) => { this.warn(error) })

    this.debug('config: %j', this.config)
    this.debug('SpeakerService: %j', this.config.SpeakerService.UUID)
    this.debug('VolumeCharacteristic: %j', this.config.VolumeCharacteristic.UUID)
  }

  // Parse config.json into this.config.
  parseConfigJson (configJson) {
    this.config = {
      maxFavourites: 96,
      mdns: true,
      port: 0,
      resetTimeout: 500, // milliseconds
      subscriptionTimeout: 30, // minutes
      timeout: 15, // seconds
      tvIdPrefix: 'TV',
      SpeakerService: this.Services.hap.Switch,
      VolumeCharacteristic: this.Characteristics.hap.Volume
    }
    const optionParser = new OptionParser(this.config, true)
    optionParser
      .on('userInputError', (message) => {
        this.warn('config.json: %s', message)
      })
      .stringKey('platform')
      .stringKey('name')
      .boolKey('alarms')
      .boolKey('brightness')
      .boolKey('excludeAirPlay')
      .intKey('heartrate', 1, 60)
      .boolKey('leds')
      .intKey('maxFavourites', 16, 96)
      .boolKey('mdns')
      .intKey('port', 0, 65535)
      .intKey('resetTimeout', 1, 60)
      .enumKey('service')
      .enumKeyValue('service', 'fan', () => {
        this.config.SpeakerService = this.Services.hap.Fan
        this.config.VolumeCharacteristic = this.Characteristics.hap.RotationSpeed
      })
      .enumKeyValue('service', 'light', () => {
        this.config.SpeakerService = this.Services.hap.Lightbulb
        this.config.VolumeCharacteristic = this.Characteristics.hap.Brightness
      })
      .enumKeyValue('service', 'speaker', () => {
        this.config.SpeakerService = this.Services.hap.Speaker
        this.config.VolumeCharacteristic = this.Characteristics.hap.Volume
      })
      .enumKeyValue('service', 'switch', () => {
        this.config.SpeakerService = this.Services.hap.Switch
        this.config.VolumeCharacteristic = this.Characteristics.hap.Volume
      })
      .boolKey('speakers')
      .intKey('subscriptionTimeout', 1, 1440) // minutes
      .intKey('timeout', 1, 60) // seconds
      .boolKey('tv')
      .stringKey('tvIdPrefix', true)
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
    } catch (error) { this.fatal(error) }
  }

  async import () {
    if (this.importDone) {
      return
    }
    this.importDone = true
    if (this.config.speakers && ZpService.Speaker == null) {
      await import('./ZpService/Speaker.js')
    }
    if (this.config.leds && ZpAccessory.Slave == null) {
      await import('./ZpAccessory/Slave.js')
      await import('./ZpService/Led.js')
    }
    if (this.config.alarms && ZpService.Alarm == null) {
      await import('./ZpService/Alarm.js')
    }
    if (this.config.tv && ZpAccessory.Tv == null) {
      await import('./ZpAccessory/Tv.js')
      await import('./ZpService/Tv.js')
    }
  }

  heartbeat (beat) {
    if (beat % 300 === 30) {
      if (Object.keys(this.households).length === 0) {
        this.warn('no zone players found')
        return
      }
      const now = new Date()
      for (const householdId in this.households) {
        const associatedZpClient = this.households[householdId].zpClient
        for (const id in associatedZpClient.zonePlayers) {
          try {
            const zpClient = this.zpClients[id]
            if (zpClient == null || zpClient.lastSeen === 'n/a') {
              continue
            }
            const delta = Math.round((now - new Date(zpClient.lastSeen)) / 1000)
            const log = (delta >= 600 ? this.log : this.debug).bind(this)
            log(
              '%s [%s]: lastSeen: %s, %js ago at %s, bootSeq: %j', zpClient.id,
              zpClient.zonePlayerName, zpClient.lastSeen, delta,
              zpClient.address, zpClient.bootSeq
            )
            if (zpClient.delta >= 600) {
              this.lostZonePlayer(zpClient.id)
            }
          } catch (error) {
            this.error('%s: [%s]: %s', id, this.zpClients[id].address, error)
          }
        }
      }
    }
  }

  async accessoryRestored (className, version, id, name, context) {
    // this.log(
    //   '%s [%s]: restoring %s v%s context: %j',
    //   id, name, className, version, context
    // )
    try {
      this.staleAccessories[id] = {}
      await this.createZpClient(id, context.address, context.household)
    } catch (error) {
      this.error(error)
    }
    // this.log(
    //   '%s [%s]: %s v%s restore done', id, name, className, version
    // )
  }

  async handleMdnsMessage (message) {
    try {
      const id = message.txt?.uuid
      const address = message.referer?.address
      const household = message.txt?.hhid
      const bootseq = parseInt(message.txt?.bootseq)
      if (id == null || address == null || household == null || bootseq == null) {
        this.debug('mdns: ignore message %j', message)
        return
      }
      this.debug('mdns: found %s at %s', id, address)
      const zpClient = await this.createZpClient(id, address, household)
      await zpClient.handleAliveMessage({ id, address, household, bootseq })
    } catch (error) { this.warn('mdns: message %j: %s', message, error) }
  }

  async handleUpnpMessage (address, message) {
    try {
      const id = message.usn.split(':')[1]
      if (message.st != null) {
        this.debug('upnp: found %s at %s', id, address)
      } else {
        this.debug('upnp: %s is alive at %s', id, address)
      }
      const household = message['x-rincon-household']
      const bootseq = parseInt(message['x-rincon-bootseq'])
      const zpClient = await this.createZpClient(id, address, household)
      await zpClient.handleAliveMessage({ id, address, household, bootseq })
    } catch (error) { this.warn('upnp: message %j: %s', message, error) }
  }

  // Create new zpClient.
  async createZpClient (id, address, household) {
    await this.import()
    let zpClient = this.zpClients[id]
    if (zpClient != null && zpClient.address === address) {
      return zpClient
    }
    this.zpClients[id] = new ZpClient({
      host: address,
      id,
      household,
      listener: this.listener,
      timeout: this.config.timeout
    })
    zpClient = this.zpClients[id]
    zpClient
      .on('request', (request) => {
        this.debug(
          '%s [%s]: request %s: %s %s%s', zpClient.id,
          zpClient.zonePlayerName == null ? zpClient.address : zpClient.zonePlayerName,
          request.id, request.method, request.resource,
          request.action == null ? '' : ' ' + request.action
        )
      })
      .on('response', (response) => {
        this.debug(
          '%s [%s]: request %s: status %d %s', zpClient.id,
          zpClient.zonePlayerName == null ? zpClient.address : zpClient.zonePlayerName,
          response.request.id, response.statusCode, response.statusMessage
        )
      })
      .on('error', (error) => {
        if (error.request == null) {
          this.warn(
            '%s [%s]: %s', zpClient.id,
            zpClient.zonePlayerName == null ? zpClient.address : zpClient.zonePlayerName,
            error
          )
          return
        }
        if (error.request.body == null) {
          this.log(
            '%s [%s]: request %d: %s %s', zpClient.id,
            zpClient.zonePlayerName == null ? zpClient.address : zpClient.zonePlayerName,
            error.request.id, error.request.method, error.request.resource
          )
        } else {
          this.log(
            '%s [%s]: request %d: %s %s', zpClient.id,
            zpClient.zonePlayerName == null ? zpClient.address : zpClient.zonePlayerName,
            error.request.id, error.request.method, error.request.resource,
            error.request.action
          )
        }
        this.warn(
          '%s [%s]: request %s: %s', zpClient.id,
          zpClient.zonePlayerName == null ? zpClient.address : zpClient.zonePlayerName,
          error.request.id, error
        )
      })
      .on('message', (message) => {
        const notify = message.device === 'ZonePlayer'
          ? message.service
          : message.device + '/' + message.service
        this.debug(
          '%s [%s]: notify %s/Event', zpClient.id,
          zpClient.zonePlayerName == null ? zpClient.address : zpClient.zonePlayerName,
          notify
        )
        this.vdebug(
          '%s [%s]: notify %s/Event: %j', zpClient.id,
          zpClient.zonePlayerName == null ? zpClient.address : zpClient.zonePlayerName,
          notify, message.parsedBody
        )
        this.vvdebug(
          '%s [%s]: notify %s/Event: ', zpClient.id,
          zpClient.zonePlayerName == null ? zpClient.address : zpClient.zonePlayerName,
          notify, message.body
        )
      })
      .on('rebooted', (oldBootSeq) => {
        this.warn(
          '%s [%s]: rebooted (%j -> %j)', zpClient.id,
          zpClient.zonePlayerName == null ? zpClient.address : zpClient.zonePlayerName,
          oldBootSeq, zpClient.bootSeq
        )
      })
      .on('addressChanged', (oldAddress) => {
        this.warn(
          '%s [%s]: now at %s', zpClient.id,
          zpClient.zonePlayerName == null ? oldAddress : zpClient.zonePlayerName,
          zpClient.address
        )
      })
    try {
      this.unInitialisedZpClients++
      this.debug(
        '%s [%s]: probing (%d jobs)...',
        id, address, this.unInitialisedZpClients
      )
      await zpClient.init()
      this.debug(
        '%s [%s]: %s: %s (%s) v%s, reached over local address %s',
        id, address, zpClient.zoneName,
        zpClient.modelName, zpClient.modelNumber, zpClient.version,
        zpClient.localAddress
      )
      this.topologyChanged = true
      await zpClient.initTopology()
      await this.parseZones(zpClient)
      if (!zpClient.invisible) {
        let zpHousehold = this.households[zpClient.household]
        if (zpHousehold == null) {
          zpHousehold = new ZpHousehold(this, zpClient)
          this.households[zpClient.household] = zpHousehold
        }
        if (
          zpHousehold.zpClient == null || (
            zpClient.battery == null &&
            zpHousehold.zpClient.battery != null
          )
        ) {
          zpHousehold.zpClient = zpClient
        }
      }
      delete this.staleAccessories[id]
    } catch (error) { this.error(error) }
    this.unInitialisedZpClients--
    this.debug(
      '%s [%s]: probing done (%d jobs remaining)',
      id, address, this.unInitialisedZpClients
    )
    if (this.unInitialisedZpClients === 0 && this.topologyChanged) {
      this.topologyChanged = false
      this.logTopology()
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
          this.createZpClient(
            zonePlayer.id, zonePlayer.address, zpClient.household
          ).catch((error) => { this.error(error) })
        )
      }
    }
    for (const job of jobs) {
      await job
    }
  }

  lostZonePlayer (id, zoneName) {
    const master = this.zpMasters[id]
    if (master != null) {
      master.sonosService.values.on = false
      master.sonosService.values.statusFault =
        this.Characteristics.hap.StatusFault.GENERAL_FAULT
      if (this.config.speakers) {
        master.speakerService.values.on = false
      }
    }
    const slave = this.zpSlaves[id]
    if (slave != null) {
      slave.ledService.values.statusFault =
        this.Characteristics.hap.StatusFault.GENERAL_FAULT
    }
  }

  async logTopology () {
    for (const id in this.staleAccessories) {
      if (this.zpClients[id] != null) {
        this.zpClients[id].removeAllListeners()
        delete this.zpClients[id]
      }
    }
    if (Object.keys(this.households).length === 0) {
      this.warn('no zone players found')
      if (Object.keys(this.staleAccessories).length === 0) {
        this.debug('initialised')
        this.emit('initialised')
      }
      return
    }
    const jobs = []
    this.log('found %d households', Object.keys(this.households).length)
    for (const householdId in this.households) {
      const zpHousehold = this.households[householdId]
      const associatedZpClient = zpHousehold.zpClient
      try {
        await zpHousehold.setAssociated(associatedZpClient)
      } catch (error) { this.error(error) }
      const zonePlayers = associatedZpClient.zonePlayers
      const zones = associatedZpClient.zones
      const nZones = Object.keys(zones).length
      this.log(
        '%s: found %d %s zone players in %d zones', householdId,
        Object.keys(zonePlayers).length, associatedZpClient.sonosOs, nZones
      )
      let i = 0
      let j = 0
      let nZonePlayers
      for (const id in zonePlayers) {
        try {
          const zpClient = this.zpClients[id]
          if (zpClient == null) {
            this.warn('%s: zone player not found', id)
            continue
          }
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
              ? zpClient.satellites.length
              : 0
          }
          j++
          let caps = zpClient.role
          caps += zpClient.airPlay ? ', airPlay' : ''
          caps += zpClient.audioIn ? ', audioIn' : ''
          caps += zpClient.tvIn ? ', tvIn' : ''
          this.log(
            '%s %s %s [%s]: %s (%s) (%s)', i < nZones ? '│ ' : '  ',
            j < nZonePlayers ? '├─' : '└─', zpClient.id,
            zpClient.zonePlayerName, zpClient.modelName, zpClient.modelNumber, caps
          )
        } catch (error) {
          this.error('%s: [%s]: %s', id, this.zpClients[id].address, error)
        }
      }
      for (const id in zonePlayers) {
        try {
          const zpClient = this.zpClients[id]
          if (zpClient == null) {
            this.warn('%s: cannot expose - zone player not found', id)
            continue
          }
          const a = zpClient.modelName.split(' ')
          const params = {
            name: zpClient.zoneName,
            id: zpClient.id,
            zpClient,
            zpHousehold,
            address: zpClient.address,
            household: zpClient.household,
            manufacturer: a[0],
            model: a[1] + ' (' + zpClient.modelNumber + ')',
            firmware: zpClient.version,
            battery: zpClient.battery
          }
          if (zpClient.channel != null && zpClient.channel !== '') {
            params.name += ' ' + zpClient.channel
          }
          const expose = !(this.config.excludeAirPlay && zpClient.airPlay) &&
            !zpClient.invisible
          if (zpClient.role === 'master') {
            if (expose && this.zpMasters[zpClient.id] == null) {
              this.zpMasters[zpClient.id] = new ZpAccessory.Master(this, params)
              jobs.push(once(this.zpMasters[zpClient.id], 'initialised'))
            }
            if (expose && this.config.tv && this.zpTvs[zpClient.id] == null) {
              const tvParams = Object.assign({
                master: this.zpMasters[zpClient.id]
              }, params)
              delete tvParams.battery
              this.zpTvs[zpClient.id] = new ZpAccessory.Tv(this, tvParams)
              jobs.push(once(this.zpTvs[zpClient.id], 'initialised'))
            }
          } else { // zonePlayer.role !== 'master'
            if (this.config.leds && this.zpSlaves[zpClient.id] == null) {
              const slaveParams = Object.assign({
                master: this.zpMasters[zpClient.zone]
              }, params)
              this.zpSlaves[zpClient.id] = new ZpAccessory.Slave(this, slaveParams)
              jobs.push(once(this.zpSlaves[zpClient.id], 'initialised'))
            }
          }
        } catch (error) {
          this.error('%s: [%s]: %s', id, this.zpClients[id].address, error)
        }
      }
    }
    for (const job of jobs) {
      await job
    }
    if (Object.keys(this.staleAccessories).length === 0) {
      this.debug('initialised')
      this.emit('initialised')
    }
  }

  // Return coordinator for group.
  groupCoordinator (groupId) {
    return this.zpMasters[groupId]
  }

  // Return array of members for group.
  groupMembers (groupId) {
    const members = []
    for (const id in this.zpMasters) {
      const accessory = this.zpMasters[id]
      if (!accessory.isCoordinator && accessory.zpClient.zoneGroup === groupId) {
        members.push(accessory)
      }
    }
    return members
  }

  // Set coordinator zpAccessory as default coordinator
  setPlatformCoordinator (coordinator) {
    const household = coordinator.zpClient.household
    this.coordinators[household] = coordinator
    for (const id in this.zpMasters) {
      const accessory = this.zpMasters[id]
      const service = accessory.sonosService
      if (service != null && accessory.zpClient.household === household) {
        service.values.sonosCoordinator = accessory === coordinator
        service.values.platformCoordinatorId = coordinator.zpClient.id
      }
    }
  }
}

export { ZpPlatform }
