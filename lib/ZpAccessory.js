// homebridge-zp/lib/ZpAccessory.js
// Copyright © 2016-2019 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

const events = require('events')
const homebridgeLib = require('homebridge-lib')

const ZpService = require('./ZpService')

const remoteKeys = {}
const volumeSelectors = {}

function init (characteristicHap) {
  if (Object.keys(remoteKeys).length > 0) {
    return
  }
  remoteKeys[characteristicHap.RemoteKey.REWIND] = 'Rewind'
  remoteKeys[characteristicHap.RemoteKey.FAST_FORWARD] = 'Fast Forward'
  remoteKeys[characteristicHap.RemoteKey.NEXT_TRACK] = 'Next Track'
  remoteKeys[characteristicHap.RemoteKey.PREVIOUS_TRACK] = 'Previous Track'
  remoteKeys[characteristicHap.RemoteKey.ARROW_UP] = 'Up'
  remoteKeys[characteristicHap.RemoteKey.ARROW_DOWN] = 'Down'
  remoteKeys[characteristicHap.RemoteKey.ARROW_LEFT] = 'Left'
  remoteKeys[characteristicHap.RemoteKey.ARROW_RIGHT] = 'Right'
  remoteKeys[characteristicHap.RemoteKey.SELECT] = 'Select'
  remoteKeys[characteristicHap.RemoteKey.BACK] = 'Back'
  remoteKeys[characteristicHap.RemoteKey.EXIT] = 'Exit'
  remoteKeys[characteristicHap.RemoteKey.PLAY_PAUSE] = 'Play/Pause'
  remoteKeys[characteristicHap.RemoteKey.INFORMATION] = 'Info'
  volumeSelectors[characteristicHap.VolumeSelector.INCREMENT] = 'Up'
  volumeSelectors[characteristicHap.VolumeSelector.DECREMENT] = 'Down'
}

// ===== SONOS ACCESSORY =======================================================

class ZpAccessory extends homebridgeLib.AccessoryDelegate {
  constructor (platform, params) {
    params.category = platform.Accessory.hap.Categories.SPEAKER
    super(platform, params)
    this.context.name = params.name
    this.context.id = params.id
    this.context.address = params.address
    this.setAlive()

    init(this.Characteristic.hap)
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
    this.sonosService = new ZpService.Sonos(this)
    if (this.platform.config.speakers) {
      this.speakerService = new ZpService.Speaker(this)
    }
    if (this.platform.config.leds) {
      this.addLedService(this.zpClient)
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

// // Called by homebridge to initialise a static accessory.
// ZpAccessory.prototype.getServices = function () {
//   if (this.platform.tv) {
//     this.groupService = new Service.Television(this.name, 'group')
//     this.groupService.getCharacteristic(Characteristic.ConfiguredName)
//       .updateValue(this.name)
//       .on('set', (value, callback) => {
//         this.log.info('%s: configured name changed to %j', this.name, value)
//         callback()
//       })
//     this.groupService.getCharacteristic(Characteristic.SleepDiscoveryMode)
//       .updateValue(Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE)
//     this.groupService.getCharacteristic(Characteristic.Active)
//       .on('set', (value, callback) => {
//         this.log.info('%s: active changed to %s', this.name, value)
//         const on = value === Characteristic.Active.ACTIVE
//         return this.setGroupOn(on, callback)
//       })
//     this.groupService.getCharacteristic(Characteristic.ActiveIdentifier)
//       .setProps({ maxValue: this.tv ? 3 : 2 })
//       .setValue(1)
//       .on('set', (value, callback) => {
//         this.log.info('%s: active identifier changed to %j', this.name, value)
//         callback()
//       })
//     this.groupService.getCharacteristic(Characteristic.RemoteKey)
//       .on('set', (value, callback) => {
//         this.log.debug('%s: %s (%j)', this.name, remoteKeys[value], value)
//         switch (value) {
//           case Characteristic.RemoteKey.PLAY_PAUSE:
//             return this.setGroupOn(!this.state.group.on, callback)
//           case Characteristic.RemoteKey.ARROW_LEFT:
//             return this.setGroupChangeTrack(-1, callback, false)
//           case Characteristic.RemoteKey.ARROW_RIGHT:
//             return this.setGroupChangeTrack(1, callback, false)
//           default:
//             return callback()
//         }
//       })
//     this.groupService.getCharacteristic(Characteristic.PowerModeSelection)
//       .on('set', (value, callback) => {
//         this.log.info('%s: power mode selection changed to %j', this.name, value)
//         return callback()
//       })
//     this.services.push(this.groupService)
//
//     this.televisionSpeakerService = new Service.TelevisionSpeaker(this.zp.zone + ' Speakers', 'zone')
//     this.televisionSpeakerService
//       .updateCharacteristic(Characteristic.VolumeControlType, Characteristic.VolumeControlType.ABSOLUTE)
//     this.televisionSpeakerService.getCharacteristic(Characteristic.VolumeSelector)
//       .on('set', (value, callback) => {
//         this.log.debug('%s: %s (%j)', this.name, volumeSelectors[value], value)
//         const volume = value === Characteristic.VolumeSelector.INCREMENT ? 1 : -1
//         this.setZoneChangeVolume(volume, callback, false)
//       })
//     this.services.push(this.televisionSpeakerService)
//     // this.groupService.addLinkedService(this.televisionSpeakerService)
//
//     const displayOrder = []
//
//     this.inputService1 = new Service.InputSource(this.name, 1)
//     this.inputService1
//       .updateCharacteristic(Characteristic.ConfiguredName, 'Uno')
//       .updateCharacteristic(Characteristic.Identifier, 1)
//       .updateCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.TUNER)
//       .updateCharacteristic(Characteristic.InputDeviceType, Characteristic.InputDeviceType.AUDIO_SYSTEM)
//       .updateCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED)
//       .updateCharacteristic(Characteristic.CurrentVisibilityState, Characteristic.CurrentVisibilityState.SHOWN)
//     this.services.push(this.inputService1)
//     this.groupService.addLinkedService(this.inputService1)
//     displayOrder.push(0x01, 0x04, 0x01, 0x00, 0x00, 0x00)
//
//     this.inputService2 = new Service.InputSource(this.name, 2)
//     this.inputService2
//       .updateCharacteristic(Characteristic.ConfiguredName, 'Due')
//       .updateCharacteristic(Characteristic.Identifier, 2)
//       .updateCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.TUNER)
//       .updateCharacteristic(Characteristic.InputDeviceType, Characteristic.InputDeviceType.AUDIO_SYSTEM)
//       .updateCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED)
//       .updateCharacteristic(Characteristic.CurrentVisibilityState, Characteristic.CurrentVisibilityState.SHOWN)
//     this.services.push(this.inputService2)
//     this.groupService.addLinkedService(this.inputService2)
//     displayOrder.push(0x01, 0x04, 0x02, 0x00, 0x00, 0x00)
//
//     if (this.tv) {
//       this.inputService3 = new Service.InputSource(this.name, 3)
//       this.inputService3
//         .updateCharacteristic(Characteristic.ConfiguredName, 'TV')
//         .updateCharacteristic(Characteristic.Identifier, 3)
//         .updateCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.TUNER)
//         .updateCharacteristic(Characteristic.InputDeviceType, Characteristic.InputDeviceType.TV)
//         .updateCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED)
//         .updateCharacteristic(Characteristic.CurrentVisibilityState, Characteristic.CurrentVisibilityState.SHOWN)
//       this.services.push(this.inputService3)
//       this.groupService.addLinkedService(this.inputService3)
//       displayOrder.push(0x01, 0x04, 0x03, 0x00, 0x00, 0x00)
//     }
//
//     displayOrder.push(0x00, 0x00)
//     this.groupService.getCharacteristic(Characteristic.DisplayOrder)
//       .updateValue(Buffer.from(displayOrder).toString('base64'))
//   }
// }
