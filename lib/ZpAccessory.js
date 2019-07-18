// homebridge-zp/lib/ZpAccessory.js
// Copyright © 2016-2019 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

const events = require('events')
const homebridgeLib = require('homebridge-lib')

const ZpService = require('./ZpService')

class ZpAccessory extends homebridgeLib.AccessoryDelegate {
  constructor (platform, params) {
    params.category = platform.Accessory.hap.Categories.SPEAKER
    super(platform, params)
    this.context.name = params.name
    this.context.id = params.id
    this.context.address = params.address
    this.setAlive()

    this.alarmServices = {}
    this.ledServices = {}
    this.on('identify', async () => {
      try {
        if (this.blinking) {
          return
        }
        this.blinking = true
        const on = await this.zpClient.getLedState()
        for (let n = 0; n < 10; n++) {
          this.zpClient.setLedState(n % 2 === 0)
          await events.once(this, 'heartbeat')
        }
        await this.zpClient.setLedState(on)
        this.blinking = false
      } catch (error) {
        this.error(error)
      }
    })
    this.zpClient = platform.zpClients[params.id]
    this.zpClient.on('event', (device, service, payload) => {
      try {
        const f = `handle${device}${service}Event`
        if (this[f] != null) {
          this.debug('%s event', service)
          // this.debug('%s event: %j', service, payload)
          this[f](payload)
        }
      } catch (error) {
        this.error(error)
      }
    })
    if (this.zpClient.role === 'master') {
      this.sonosService = new ZpService.Sonos(this)
      if (this.platform.config.speakers) {
        this.speakerService = new ZpService.Speaker(this)
      }
    }
    if (this.platform.config.leds) {
      this.addLedService(this.zpClient)
    }
    if (this.platform.config.tv) {
      this.tvService = new ZpService.Tv(this)
    }
    this.zpClient.subscribe('/GroupManagement/Event')
      .catch((error) => {
        this.error(error)
      })
    if (this.platform.config.alarms) {
      this.zpClient.subscribe('/AlarmClock/Event')
        .catch((error) => {
          this.error(error)
        })
    }
  }

  addLedService (zpClient) {
    if (this.ledServices[zpClient.id] == null) {
      this.ledServices[zpClient.id] = new ZpService.Led(this, zpClient)
    }
  }

  handleZonePlayerGroupManagementEvent (event) {
    this.isCoordinator = event.groupCoordinatorIsLocal === 1
    this.groupId = event.localGroupUuid
    if (this.isCoordinator) {
      this.coordinator = this
      this.sonosService.values.sonosGroup = this.zpClient.zoneName
      for (const member of this.members()) {
        member.coordinator = this
        member.copyCoordinator()
      }
      if (this.platform.coordinator !== this && this.speakerService != null) {
        this.speakerService.values.on = false
      }
    } else {
      this.coordinator = this.platform.groupCoordinator(this.groupId)
      if (this.coordinator) {
        this.copyCoordinator()
      }
      if (this.speakerService != null) {
        this.speakerService.values.on = true
      }
    }
    this.emit('groupInitialised')
  }

  async handleZonePlayerAlarmClockEvent (event) {
    const alarms = (await this.zpClient.listAlarms()).currentAlarmList
    for (const alarm of alarms) {
      if (alarm.roomUuid === this.zpClient.id) {
        const service = this.alarmServices[alarm.id]
        if (service == null) {
          this.alarmServices[alarm.id] = new ZpService.Alarm(this, alarm)
        } else {
          service.alarm = alarm
        }
      } else {
        if (this.alarmServices[alarm.id] != null) {
          this.log('remove Alarm %s', alarm.id)
          this.alarmServices[alarm.id].destroy()
          delete this.alarmServices[alarm.id]
        }
      }
    }
  }

  // Copy group characteristic values from group coordinator.
  copyCoordinator () {
    const coordinator = this.coordinator
    if (coordinator && coordinator !== this && !this.leaving) {
      coordinator.becomePlatformCoordinator()
      const src = coordinator.sonosService.values
      const dst = this.sonosService.values
      dst.sonosGroup = src.sonosGroup
      dst.on = src.on
      dst.volume = src.volume
      dst.mute = src.mute
      dst.currentTrack = src.currentTrack
      dst.currentTransportActions = src.currentTransportActions
    }
  }

  // Return array of members.
  members () {
    if (!this.isCoordinator) {
      return []
    }
    return this.platform.groupMembers(this.groupId)
  }

  becomePlatformCoordinator () {
    this.platform.setPlatformCoordinator(this)
    if (this.speakerService != null) {
      this.speakerService.values.on = true
    }
  }
}

module.exports = ZpAccessory
