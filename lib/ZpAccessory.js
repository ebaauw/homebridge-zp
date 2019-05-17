// homebridge-zp/lib/ZpAccessory.js
// Copyright © 2016-2019 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

const ZpAlarmModule = require('./ZpAlarm')
const ZpAlarm = ZpAlarmModule.ZpAlarm

const events = require('events')
const he = require('he')
const request = require('request')
const SonosModule = require('sonos')
const util = require('util')
const xml2js = require('xml2js')

module.exports = {
  setHomebridge: setHomebridge,
  ZpAccessory: ZpAccessory
}

let Service
let Characteristic
let my

const remoteKeys = {}
const volumeSelectors = {}

function setHomebridge (Homebridge) {
  Service = Homebridge.hap.Service
  Characteristic = Homebridge.hap.Characteristic
  remoteKeys[Characteristic.RemoteKey.REWIND] = 'Rewind'
  remoteKeys[Characteristic.RemoteKey.FAST_FORWARD] = 'Fast Forward'
  remoteKeys[Characteristic.RemoteKey.NEXT_TRACK] = 'Next Track'
  remoteKeys[Characteristic.RemoteKey.PREVIOUS_TRACK] = 'Previous Track'
  remoteKeys[Characteristic.RemoteKey.ARROW_UP] = 'Up'
  remoteKeys[Characteristic.RemoteKey.ARROW_DOWN] = 'Down'
  remoteKeys[Characteristic.RemoteKey.ARROW_LEFT] = 'Left'
  remoteKeys[Characteristic.RemoteKey.ARROW_RIGHT] = 'Right'
  remoteKeys[Characteristic.RemoteKey.SELECT] = 'Select'
  remoteKeys[Characteristic.RemoteKey.BACK] = 'Back'
  remoteKeys[Characteristic.RemoteKey.EXIT] = 'Exit'
  remoteKeys[Characteristic.RemoteKey.PLAY_PAUSE] = 'Play/Pause'
  remoteKeys[Characteristic.RemoteKey.INFORMATION] = 'Info'
  volumeSelectors[Characteristic.VolumeSelector.INCREMENT] = 'Up'
  volumeSelectors[Characteristic.VolumeSelector.DECREMENT] = 'Down'
}

const tvModels = [
  'ZPS9', // PlayBar.
  'ZPS11', // Playbase, see #58.
  'ZPS16' // Amp, see #8.
]

const stereoModels = [
  'ZP90' // Connect
]

// ===== SONOS ACCESSORY =======================================================

// Constructor for ZpAccessory.
function ZpAccessory (platform, zp) {
  this.name = platform.nameScheme.replace('%', zp.zone)
  this.uuid_base = zp.id
  this.zp = zp
  this.platform = platform
  this.tv = tvModels.includes(this.zp.model)
  this.hasBalance = stereoModels.includes(this.zp.model) ||
    (this.zp.hasSlaves && !tvModels.includes(this.zp.model))
  my = my || this.platform.my
  this.subscriptions = {}
  this.state = {
    group: {},
    zone: {},
    light: {}
  }
  this.log = this.platform.log
  this.parser = new xml2js.Parser()
  if (this.tv !== this.zp.tv) {
    this.log.warn('%s: warning: TV detection fails for %s: tv: %j, zp.tv: %j', this.name, this.zp.model, this.tv, this.zp.tv)
  }

  this.infoService = new Service.AccessoryInformation()
  this.infoService
    .updateCharacteristic(Characteristic.Manufacturer, 'homebridge-zp')
    .updateCharacteristic(Characteristic.Model, this.zp.model)
    .updateCharacteristic(Characteristic.SerialNumber, this.uuid_base)
    .updateCharacteristic(Characteristic.FirmwareRevision, this.zp.version)
  this.services = [this.infoService]

  if (this.platform.tv) {
    this.groupService = new Service.Television(this.name, 'group')
    this.groupService.getCharacteristic(Characteristic.ConfiguredName)
      .updateValue(this.name)
      .on('set', (value, callback) => {
        this.log.info('%s: configured name changed to %j', this.name, value)
        callback()
      })
    this.groupService.getCharacteristic(Characteristic.SleepDiscoveryMode)
      .updateValue(Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE)
    this.groupService.getCharacteristic(Characteristic.Active)
      .on('set', (value, callback) => {
        this.log.info('%s: active changed to %s', this.name, value)
        const on = value === Characteristic.Active.ACTIVE
        return this.setGroupOn(on, callback)
      })
    this.groupService.getCharacteristic(Characteristic.ActiveIdentifier)
      .setProps({ maxValue: this.tv ? 3 : 2 })
      .setValue(1)
      .on('set', (value, callback) => {
        this.log.info('%s: active identifier changed to %j', this.name, value)
        callback()
      })
    this.groupService.getCharacteristic(Characteristic.RemoteKey)
      .on('set', (value, callback) => {
        this.log.debug('%s: %s (%j)', this.name, remoteKeys[value], value)
        switch (value) {
          case Characteristic.RemoteKey.PLAY_PAUSE:
            return this.setGroupOn(!this.state.group.on, callback)
          case Characteristic.RemoteKey.ARROW_LEFT:
            return this.setGroupChangeTrack(-1, callback, false)
          case Characteristic.RemoteKey.ARROW_RIGHT:
            return this.setGroupChangeTrack(1, callback, false)
          default:
            return callback()
        }
      })
    this.groupService.getCharacteristic(Characteristic.PowerModeSelection)
      .on('set', (value, callback) => {
        this.log.info('%s: power mode selection changed to %j', this.name, value)
        return callback()
      })
    this.services.push(this.groupService)

    this.televisionSpeakerService = new Service.TelevisionSpeaker(this.zp.zone + ' Speakers', 'zone')
    this.televisionSpeakerService
      .updateCharacteristic(Characteristic.VolumeControlType, Characteristic.VolumeControlType.ABSOLUTE)
    this.televisionSpeakerService.getCharacteristic(Characteristic.VolumeSelector)
      .on('set', (value, callback) => {
        this.log.debug('%s: %s (%j)', this.name, volumeSelectors[value], value)
        const volume = value === Characteristic.VolumeSelector.INCREMENT ? 1 : -1
        this.setZoneChangeVolume(volume, callback, false)
      })
    this.services.push(this.televisionSpeakerService)
    // this.groupService.addLinkedService(this.televisionSpeakerService)

    const displayOrder = []

    this.inputService1 = new Service.InputSource(this.name, 1)
    this.inputService1
      .updateCharacteristic(Characteristic.ConfiguredName, 'Uno')
      .updateCharacteristic(Characteristic.Identifier, 1)
      .updateCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.TUNER)
      .updateCharacteristic(Characteristic.InputDeviceType, Characteristic.InputDeviceType.AUDIO_SYSTEM)
      .updateCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED)
      .updateCharacteristic(Characteristic.CurrentVisibilityState, Characteristic.CurrentVisibilityState.SHOWN)
    this.services.push(this.inputService1)
    this.groupService.addLinkedService(this.inputService1)
    displayOrder.push(0x01, 0x04, 0x01, 0x00, 0x00, 0x00)

    this.inputService2 = new Service.InputSource(this.name, 2)
    this.inputService2
      .updateCharacteristic(Characteristic.ConfiguredName, 'Due')
      .updateCharacteristic(Characteristic.Identifier, 2)
      .updateCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.TUNER)
      .updateCharacteristic(Characteristic.InputDeviceType, Characteristic.InputDeviceType.AUDIO_SYSTEM)
      .updateCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED)
      .updateCharacteristic(Characteristic.CurrentVisibilityState, Characteristic.CurrentVisibilityState.SHOWN)
    this.services.push(this.inputService2)
    this.groupService.addLinkedService(this.inputService2)
    displayOrder.push(0x01, 0x04, 0x02, 0x00, 0x00, 0x00)

    if (this.tv) {
      this.inputService3 = new Service.InputSource(this.name, 3)
      this.inputService3
        .updateCharacteristic(Characteristic.ConfiguredName, 'TV')
        .updateCharacteristic(Characteristic.Identifier, 3)
        .updateCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.TUNER)
        .updateCharacteristic(Characteristic.InputDeviceType, Characteristic.InputDeviceType.TV)
        .updateCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED)
        .updateCharacteristic(Characteristic.CurrentVisibilityState, Characteristic.CurrentVisibilityState.SHOWN)
      this.services.push(this.inputService3)
      this.groupService.addLinkedService(this.inputService3)
      displayOrder.push(0x01, 0x04, 0x03, 0x00, 0x00, 0x00)
    }

    displayOrder.push(0x00, 0x00)
    this.groupService.getCharacteristic(Characteristic.DisplayOrder)
      .updateValue(Buffer.from(displayOrder).toString('base64'))
  } else {
    this.groupService = new this.platform.SpeakerService(this.name, 'group')
    this.services.push(this.groupService)
    this.groupService.addOptionalCharacteristic(Characteristic.On)
    this.groupService.getCharacteristic(Characteristic.On)
      .on('set', this.setGroupOn.bind(this))
  }

  this.groupService.addOptionalCharacteristic(this.platform.VolumeCharacteristic)
  this.groupService.getCharacteristic(this.platform.VolumeCharacteristic)
    .on('set', this.setGroupVolume.bind(this))
  this.groupService.addOptionalCharacteristic(my.Characteristic.ChangeVolume)
  this.groupService.getCharacteristic(my.Characteristic.ChangeVolume)
    .updateValue(0)
    .on('set', this.setGroupChangeVolume.bind(this))
  this.groupService.addOptionalCharacteristic(Characteristic.Mute)
  this.groupService.getCharacteristic(Characteristic.Mute)
    .on('set', this.setGroupMute.bind(this))
  // this.groupService.addOptionalCharacteristic(my.Characteristic.ChangeInput)
  // this.groupService.getCharacteristic(my.Characteristic.ChangeInput)
  //   .updateValue(0)
  //   .on('set', this.setGroupChangeInput.bind(this))
  this.groupService.addOptionalCharacteristic(my.Characteristic.ChangeTrack)
  this.groupService.getCharacteristic(my.Characteristic.ChangeTrack)
    .updateValue(0)
    .on('set', this.setGroupChangeTrack.bind(this))
  this.groupService.addOptionalCharacteristic(my.Characteristic.CurrentTrack)
  if (this.tv) {
    this.groupService.addOptionalCharacteristic(my.Characteristic.TV)
  }
  this.groupService.addOptionalCharacteristic(my.Characteristic.SonosGroup)
  this.groupService.addOptionalCharacteristic(my.Characteristic.SonosCoordinator)
  this.groupService.getCharacteristic(my.Characteristic.SonosCoordinator)
    .updateValue(false)
    .on('set', this.setGroupSonosCoordinator.bind(this))

  this.zoneService = new this.platform.SpeakerService(
    this.zp.zone + ' Speakers', 'zone'
  )
  this.zoneService.addOptionalCharacteristic(Characteristic.On)
  this.zoneService.getCharacteristic(Characteristic.On)
    .on('set', this.setZoneOn.bind(this))
  this.zoneService.addOptionalCharacteristic(this.platform.VolumeCharacteristic)
  this.zoneService.getCharacteristic(this.platform.VolumeCharacteristic)
    .on('set', this.setZoneVolume.bind(this))
  this.zoneService.addOptionalCharacteristic(my.Characteristic.ChangeVolume)
  this.zoneService.getCharacteristic(my.Characteristic.ChangeVolume)
    .updateValue(0)
    .on('set', this.setZoneChangeVolume.bind(this))
  this.zoneService.addOptionalCharacteristic(Characteristic.Mute)
  this.zoneService.getCharacteristic(Characteristic.Mute)
    .on('set', this.setZoneMute.bind(this))
  if (this.hasBalance) {
    this.zoneService.addOptionalCharacteristic(my.Characteristic.Balance)
    this.zoneService.getCharacteristic(my.Characteristic.Balance)
      .on('set', this.setZoneBalance.bind(this))
  }
  this.zoneService.addOptionalCharacteristic(my.Characteristic.Bass)
  this.zoneService.getCharacteristic(my.Characteristic.Bass)
    .on('set', this.setZoneBass.bind(this))
  this.zoneService.addOptionalCharacteristic(my.Characteristic.Treble)
  this.zoneService.getCharacteristic(my.Characteristic.Treble)
    .on('set', this.setZoneTreble.bind(this))
  this.zoneService.addOptionalCharacteristic(my.Characteristic.Loudness)
  this.zoneService.getCharacteristic(my.Characteristic.Loudness)
    .on('set', this.setZoneLoudness.bind(this))
  if (this.platform.speakers) {
    this.services.push(this.zoneService)
  }

  this.lightService = new Service.Lightbulb(this.zp.zone + ' Sonos LED', 'light')
  this.lightService.getCharacteristic(Characteristic.On)
    .on('get', this.getLightOn.bind(this))
    .on('set', this.setLightOn.bind(this))
  if (this.platform.leds) {
    this.services.push(this.lightService)
  }

  this.alarms = {}
  if (this.platform.alarms) {
    for (let id in zp.alarms) {
      const alarm = zp.alarms[id]
      this.alarms[alarm.ID] = new ZpAlarm(this, alarm)
      this.services.push(this.alarms[alarm.ID].service)
      this.hasAlarms = true
    }
  }

  this.avTransport = new SonosModule.Services.AVTransport(this.zp.host, this.zp.port)
  this.renderingControl = new SonosModule.Services.RenderingControl(this.zp.host, this.zp.port)
  this.groupRenderingControl = new SonosModule.Services.GroupRenderingControl(this.zp.host, this.zp.port)
  this.alarmClock = new SonosModule.Services.AlarmClock(this.zp.host, this.zp.port)

  this.on('GroupManagement', this.handleGroupManagementEvent)
  this.on('AVTransport', this.handleAVTransportEvent)
  this.on('RenderingControl', this.handleRenderingControlEvent)
  this.on('GroupRenderingControl', this.handleGroupRenderingControlEvent)
  this.on('AlarmClock', this.handleAlarmClockEvent)

  this.createSubscriptions()
}

util.inherits(ZpAccessory, events.EventEmitter)

// Called by homebridge to initialise a static accessory.
ZpAccessory.prototype.getServices = function () {
  return this.services
}

// Return array of members.
ZpAccessory.prototype.members = function () {
  if (!this.isCoordinator) {
    return []
  }
  return this.platform.groupMembers(this.group)
}

// Copy group characteristic values from group coordinator.
ZpAccessory.prototype.copyCoordinator = function () {
  const coordinator = this.coordinator
  if (coordinator && coordinator !== this && !this.leaving) {
    coordinator.becomePlatformCoordinator()
    this.log.debug('%s: copy group characteristics from %s', this.name, coordinator.name)
    if (this.state.group.on !== coordinator.state.group.on) {
      this.log.debug(
        '%s: set member %s (play/pause) from %s to %s', this.name,
        this.platform.tv ? 'active' : 'power',
        this.state.group.on, coordinator.state.group.on
      )
      this.state.group.on = coordinator.state.group.on
      if (this.platform.tv) {
        const active = this.state.group.on ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE
        this.groupService.updateCharacteristic(Characteristic.Active, active)
      } else {
        this.groupService.updateCharacteristic(Characteristic.On, this.state.group.on)
      }
    }
    if (this.state.group.volume !== coordinator.state.group.volume) {
      this.log.debug(
        '%s: set member group volume from %s to %s', this.name,
        this.state.group.volume, coordinator.state.group.volume
      )
      this.state.group.volume = coordinator.state.group.volume
      this.groupService.updateCharacteristic(this.platform.VolumeCharacteristic, this.state.group.volume)
    }
    if (this.state.group.mute !== coordinator.state.group.mute) {
      this.log.debug(
        '%s: set member group mute from %s to %s', this.name,
        this.state.group.mute, coordinator.state.group.mute
      )
      this.state.group.mute = coordinator.state.group.mute
      this.groupService.updateCharacteristic(Characteristic.Mute, this.state.group.mute)
    }
    if (this.state.group.track !== coordinator.state.group.track) {
      this.log.debug(
        '%s: set member current track from %j to %j', this.name,
        this.state.group.track, coordinator.state.group.track
      )
      this.state.group.track = coordinator.state.group.track
      this.groupService.updateCharacteristic(my.Characteristic.CurrentTrack, this.state.group.track)
    }
    if (this.state.group.name !== coordinator.state.group.name) {
      this.log.debug(
        '%s: set member sonos group from %s to %s', this.name,
        this.state.group.name, coordinator.state.group.name
      )
      this.state.group.name = coordinator.state.group.name
      this.groupService.updateCharacteristic(my.Characteristic.SonosGroup, this.state.group.name)
    }
    if (this.state.group.currentTransportActions !== coordinator.state.group.currentTransportActions) {
      this.log.debug(
        '%s: set member transport actions from %j to %j', this.name,
        this.state.group.currentTransportActions, coordinator.state.group.currentTransportActions
      )
      this.state.group.currentTransportActions = coordinator.state.group.currentTransportActions
    }
  }
}

ZpAccessory.prototype.becomePlatformCoordinator = function () {
  if (!this.platform.coordinator) {
    this.log.info('%s: platform coordinator', this.name)
    this.platform.setPlatformCoordinator(this)
    this.state.zone.on = true
    this.zoneService.updateCharacteristic(Characteristic.On, this.state.zone.on)
  }
}

// ===== SONOS EVENTS ==========================================================

ZpAccessory.prototype.createSubscriptions = function () {
  this.subscribe('GroupManagement', (err) => {
    if (err) {
      this.log.error('%s: subscribe to GroupManagement events: %s', this.name, err)
    }
    setTimeout(() => {
      // Give homebridge-zp some time to setup groups.
      for (const member of this.members()) {
        member.coordinator = this
        member.log.info('%s: member of group %s', member.name, member.coordinator.name)
        member.copyCoordinator()
      }
      this.subscribe('MediaRenderer/AVTransport', (err) => {
        if (err) {
          this.log.error('%s: subscribe to AVTransport events: %s', this.name, err)
        }
      })
      this.subscribe('MediaRenderer/GroupRenderingControl', (err) => {
        if (err) {
          this.log.error('%s: subscribe to GroupRenderingControl events: %s', this.name, err)
        }
      })
      if (this.platform.speakers) {
        this.subscribe('MediaRenderer/RenderingControl', (err) => {
          if (err) {
            this.log.error('%s: subscribe to RenderingControl events: %s', this.name, err)
          }
        })
      }
      if (this.hasAlarms) {
        this.subscribe('AlarmClock', (err) => {
          if (err) {
            this.log.error('%s: subscribe to AlarmClock events: %s', this.name, err)
          }
        })
      }
    }, 200)
  })
}

ZpAccessory.prototype.onExit = function () {
  for (const service in this.subscriptions) {
    const sid = this.subscriptions[service]
    this.unsubscribe(sid, service)
  }
}

ZpAccessory.prototype.handleGroupManagementEvent = function (data) {
  this.log.debug('%s: GroupManagement event', this.name)
  this.isCoordinator = data.GroupCoordinatorIsLocal === '1'
  this.group = data.LocalGroupUUID
  if (this.isCoordinator) {
    this.coordinator = this
    this.state.group.name = this.coordinator.zp.zone
    this.log.info('%s: coordinator for group %s', this.name, this.state.group.name)
    this.groupService.updateCharacteristic(my.Characteristic.SonosGroup, this.state.group.name)
    for (const member of this.members()) {
      member.coordinator = this
      member.copyCoordinator()
    }
    if (this.platform.coordinator !== this) {
      this.state.zone.on = false
      this.zoneService.updateCharacteristic(Characteristic.On, this.state.zone.on)
    }
  } else {
    this.coordinator = this.platform.groupCoordinator(this.group)
    if (this.coordinator) {
      this.log.info('%s: member of group %s', this.name, this.coordinator.zp.zone)
      this.copyCoordinator()
    }
    this.state.zone.on = true
    this.zoneService.updateCharacteristic(Characteristic.On, this.state.zone.on)
  }
}

ZpAccessory.prototype.handleAVTransportEvent = function (data) {
  this.log.debug('%s: AVTransport event', this.name)
  this.parser.parseString(data.LastChange, (err, json) => {
    if (err) {
      return
    }
    let on
    let track
    let currentTransportActions
    const event = json.Event.InstanceID[0]
    // this.log.debug('%s: AVTransport event: %j', this.name, event)
    if (event.TransportState && this.state.group.track !== 'TV') {
      on = event.TransportState[0].$.val === 'PLAYING'
    }
    // if (event.CurrentTrackURI) {
    //   const data = event.CurrentTrackURI[0].$.val
    //   this.log.debug('%s: AVTransport event CurrentTrackURI:      %j', this.name, data)
    // }
    if (event.CurrentTrackMetaData) {
      const data = event.CurrentTrackMetaData[0].$.val
      if (data) {
        this.parser.parseString(data, (err, json) => {
          if (!err && json['DIDL-Lite']) {
            const item = json['DIDL-Lite'].item[0]
            // this.log.debug('%s: AVTransport CurrentTrackMetaData: %j', this.name, item)
            if (item.res != null && item.res[0] != null && item.res[0]._ != null) {
              const type = item.res[0]._
              // this.log.debug('%s: AVTransport event CurrentTrackMetaData: %j', this.name, type)
              switch (type.split(':')[0]) {
                case 'x-rincon-stream': // Line in input.
                  track = he.decode(item['dc:title'][0]) // source
                  break
                case 'x-sonos-htastream': // SPDIF TV input.
                  track = 'TV'
                  const streamInfo = item['r:streamInfo'][0]
                  // "0": no input; "2": stereo; "18": Dolby Digital 5.1;
                  on = streamInfo !== '0'
                  break
                case 'x-sonosapi-vli': // Airplay2.
                  track = 'Airplay2'
                  break
                case 'aac': // Radio stream (e.g. DI.fm)
                case 'x-sonosapi-stream': // Radio stream.
                case 'x-rincon-mp3radio': // AirTunes (by homebridge-zp).
                  track = he.decode(item['r:streamContent'][0]) // info
                  if (track === '') {
                    if (event['r:EnqueuedTransportURIMetaData']) {
                      const data = event['r:EnqueuedTransportURIMetaData'][0].$.val
                      if (data) {
                        this.parser.parseString(data, (err, json) => {
                          if (err) {
                            return
                          }
                          if (json['DIDL-Lite']) {
                            track = json['DIDL-Lite'].item[0]['dc:title'][0] // station
                          }
                        })
                      }
                    }
                  }
                  break
                case 'x-file-cifs': // Library song.
                case 'x-sonos-http': // See issue #44.
                case 'http': // Song on iDevice.
                case 'https': // Apple Music, see issue #68
                case 'x-sonos-spotify': // Spotify song.
                  track = item['dc:title'][0] // song
                  // track = item['dc:creator'][0] // artist
                  // track = item['upnp:album'][0] // album
                  // track = item.res[0].$.duration // duration
                  break
                case 'x-sonosapi-hls': // ??
                  // Skip! update will arrive in subsequent CurrentTrackMetaData events
                  // and will be handled by default case
                  break
                default:
                  this.log.warn('%s: unknown track metadata %j', this.name, item)
                  if (item['dc:title']) {
                    track = item['dc:title'][0] // song
                  } else {
                    track = '(unknown)'
                  }
                  break
              }
            }
          }
        })
      }
    }
    if (event.CurrentTransportActions && this.state.group.track !== 'TV') {
      currentTransportActions = event.CurrentTransportActions[0].$.val.split(', ')
      if (currentTransportActions.length === 1) {
        track = ''
      }
    }
    if (on != null && on !== this.state.group.on) {
      this.log.info(
        '%s: set %s (play/pause) from %s to %s', this.name,
        this.platform.tv ? 'active' : 'power', this.state.group.on, on
      )
      this.state.group.on = on
      if (this.platform.tv) {
        const active = on ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE
        this.groupService.updateCharacteristic(Characteristic.Active, active)
      } else {
        this.groupService.updateCharacteristic(Characteristic.On, this.state.group.on)
      }
    }
    if (track != null && track !== this.state.group.track &&
        track !== 'ZPSTR_CONNECTING' && track !== 'ZPSTR_BUFFERING') {
      this.log.info(
        '%s: set current track from %j to %j', this.name,
        this.state.group.track, track
      )
      this.state.group.track = track
      this.groupService.updateCharacteristic(my.Characteristic.CurrentTrack, this.state.group.track)
    }
    if (this.tv && on != null) {
      const tv = on && track === 'TV'
      if (tv !== this.state.group.tv) {
        if (tv) {
          this.log.info(
            '%s: set tv from %s to %s', this.name,
            this.state.group.tv, tv
          )
          this.state.group.tv = tv
          this.groupService
            .updateCharacteristic(my.Characteristic.TV, this.state.group.tv)
        } else {
          this.tvTimer = setTimeout(() => {
            this.tvTimer = null
            this.log.info(
              '%s: set tv from %s to %s', this.name,
              this.state.group.tv, tv
            )
            this.state.group.tv = tv
            this.groupService
              .updateCharacteristic(my.Characteristic.TV, this.state.group.tv)
          }, 10000)
        }
      } else if (this.tvTimer != null) {
        clearTimeout(this.tvTimer)
        this.tvTimer = null
      }
    }
    if (
      currentTransportActions != null &&
      currentTransportActions !== this.state.group.currentTransportActions
    ) {
      // this.log.debug(
      //   '%s: transport actions changed from %j to %j', this.name,
      //   this.state.group.currentTransportActions, currentTransportActions
      // )
      this.state.group.currentTransportActions = currentTransportActions
    }
    for (const member of this.members()) {
      member.copyCoordinator()
    }
  })
}

ZpAccessory.prototype.handleGroupRenderingControlEvent = function (json) {
  this.log.debug('%s: GroupRenderingControl event', this.name)
  // this.log.debug('%s: GroupRenderingControl event: %j', this.name, json)
  this.coordinator = this
  this.leaving = false
  if (json.GroupVolume) {
    const volume = Number(json.GroupVolume)
    if (volume !== this.state.group.volume) {
      this.log.info('%s: set group volume from %s to %s', this.name, this.state.group.volume, volume)
      this.state.group.volume = volume
      this.groupService.updateCharacteristic(this.platform.VolumeCharacteristic, this.state.group.volume)
    }
  }
  if (json.GroupMute) {
    const mute = json.GroupMute === '1'
    if (mute !== this.state.group.mute) {
      this.log.info('%s: set group mute from %s to %s', this.name, this.state.group.mute, mute)
      this.state.group.mute = mute
      this.groupService.updateCharacteristic(Characteristic.Mute, this.state.group.mute)
    }
  }
  for (const member of this.members()) {
    member.copyCoordinator(this)
  }
}

ZpAccessory.prototype.handleRenderingControlEvent = function (data) {
  this.log.debug('%s: RenderingControl event', this.name)
  this.parser.parseString(data.LastChange, (err, json) => {
    if (err) {
      return
    }
    const event = json.Event.InstanceID[0]
    // this.log.debug('%s: RenderingControl event: %j', this.name, event)
    if (event.Volume) {
      let volume = 0
      let balance = 0
      for (const record of event.Volume) {
        switch (record.$.channel) {
          case 'Master':
            volume = Number(record.$.val)
            break
          case 'LF':
            balance -= Number(record.$.val)
            break
          case 'RF':
            balance += Number(record.$.val)
            break
          default:
            this.log.warn('%s: warning: %s: ingoring unknown Volume channel', this.name, record.$.channel)
            return
        }
      }
      if (volume !== this.state.zone.volume) {
        this.log.info('%s: set volume from %s to %s', this.name, this.state.zone.volume, volume)
        this.state.zone.volume = volume
        this.zoneService.updateCharacteristic(this.platform.VolumeCharacteristic, this.state.zone.volume)
      }
      if (this.hasBalance && balance !== this.state.zone.balance) {
        this.log.info('%s: set balance from %s to %s', this.name, this.state.zone.balance, balance)
        this.state.zone.balance = balance
        this.zoneService.updateCharacteristic(my.Characteristic.Balance, this.state.zone.balance)
      }
    }
    if (event.Mute) {
      const mute = event.Mute[0].$.val === '1'
      if (mute !== this.state.zone.mute) {
        this.log.info('%s: set mute from %s to %s', this.name, this.state.zone.mute, mute)
        this.state.zone.mute = mute
        this.zoneService.updateCharacteristic(Characteristic.Mute, this.state.zone.mute)
      }
    }
    if (event.Bass) {
      const bass = Number(event.Bass[0].$.val)
      if (bass !== this.state.zone.bass) {
        this.log.info('%s: set bass from %s to %s', this.name, this.state.zone.bass, bass)
        this.state.zone.bass = bass
        this.zoneService.updateCharacteristic(my.Characteristic.Bass, this.state.zone.bass)
      }
    }
    if (event.Treble) {
      const treble = Number(event.Treble[0].$.val)
      if (treble !== this.state.zone.treble) {
        this.log.info('%s: set treble from %s to %s', this.name, this.state.zone.treble, treble)
        this.state.zone.treble = treble
        this.zoneService.updateCharacteristic(my.Characteristic.Treble, this.state.zone.treble)
      }
    }
    if (event.Loudness) {
      const loudness = event.Loudness[0].$.val === '1'
      if (loudness !== this.state.zone.loudness) {
        this.log.info('%s: set loudness from %s to %s', this.name, this.state.zone.loudness, loudness)
        this.state.zone.loudness = loudness
        this.zoneService.updateCharacteristic(my.Characteristic.Loudness, this.state.zone.loudness)
      }
    }
    if (event.NightMode) {
      if (this.state.zone.nightSound == null) {
        this.zoneService.addOptionalCharacteristic(my.Characteristic.NightSound)
        this.zoneService.getCharacteristic(my.Characteristic.NightSound)
          .on('set', this.setZoneNightSound.bind(this))
      }
      const nightSound = event.NightMode[0].$.val === '1'
      if (nightSound !== this.state.zone.nightSound) {
        this.log.info('%s: set night sound from %s to %s', this.name, this.state.zone.nightSound, nightSound)
        this.state.zone.nightSound = nightSound
        this.zoneService.updateCharacteristic(my.Characteristic.NightSound, this.state.zone.nightSound)
      }
    }
    if (event.DialogLevel) {
      if (this.state.zone.speechEnhancement == null) {
        this.zoneService.addOptionalCharacteristic(my.Characteristic.SpeechEnhancement)
        this.zoneService.getCharacteristic(my.Characteristic.SpeechEnhancement)
          .on('set', this.setZoneSpeechEnhancement.bind(this))
      }
      const speechEnhancement = event.DialogLevel[0].$.val === '1'
      if (speechEnhancement !== this.state.zone.speechEnhancement) {
        this.log.info('%s: set speech enhancement from %s to %s', this.name, this.state.zone.speechEnhancement, speechEnhancement)
        this.state.zone.speechEnhancement = speechEnhancement
        this.zoneService.updateCharacteristic(my.Characteristic.SpeechEnhancement, this.state.zone.speechEnhancement)
      }
    }
  })
}

ZpAccessory.prototype.handleAlarmClockEvent = function (data) {
  this.log.debug('%s: AlarmClock event', this.name)
  if (data.AlarmListVersion === this.platform.alarmListVersion) {
    // Already handled.
    return
  }
  this.platform.alarmListVersion = data.AlarmListVersion
  this.log.debug(
    '%s: alarm list version %s', this.name, this.platform.alarmListVersion
  )
  this.alarmClock.ListAlarms((err, alarmClock) => {
    if (err) {
      return
    }
    for (const alarm of alarmClock.CurrentAlarmList) {
      const zp = this.platform.zpAccessories[alarm.RoomUUID]
      if (zp && zp.alarms[alarm.ID]) {
        zp.alarms[alarm.ID].handleAlarm(alarm)
      }
    }
  })
}

// ===== HOMEKIT EVENTS ========================================================

ZpAccessory.prototype.blink = function (n) {
  this.zp.setLEDState('On', (err) => {
    if (err) {
      this.log.error('%s: set led state: %s', this.name, err)
    }
    setTimeout(() => {
      this.zp.setLEDState('Off', (err) => {
        if (err) {
          this.log.error('%s: set led state: %s', this.name, err)
        }
      })
      setTimeout(() => {
        if (--n > 0) {
          return this.blink(n)
        }
        this.zp.setLEDState(this.state.light.on ? 'On' : 'Off', (err) => {
          if (err) {
            this.log.error('%s: set led state: %s', this.name, err)
          }
          this.lightService.updateCharacteristic(Characteristic.On, this.state.light.on)
          this.blinking = false
        })
      }, 1000)
    }, 1000)
  })
}

// Called by homebridge when accessory is identified from HomeKit.
ZpAccessory.prototype.identify = function (callback) {
  this.log.info('%s: identify', this.name)
  if (this.blinking) {
    return callback()
  }
  this.blinking = true
  this.zp.getLEDState((err, on) => {
    if (err) {
      this.log.error('%s: get led state: %s', this.name, err)
      this.blinking = false
      return callback(err)
    }
    this.state.light.on = on === 'On'
    this.blink(5)
    return callback()
  })
}

// Called by homebridge when characteristic is changed from homekit.
ZpAccessory.prototype.setZoneOn = function (on, callback) {
  on = !!on
  if (this.state.zone.on === on) {
    return callback()
  }
  this.log.info('%s: power (group membership) changed from %s to %s', this.name, this.state.zone.on, on)
  this.state.zone.on = on
  if (on) {
    const coordinator = this.platform.coordinator
    if (coordinator) {
      return this.join(coordinator, callback)
    }
    this.becomePlatformCoordinator()
    return callback()
  } else {
    if (this.platform.coordinator === this) {
      this.platform.coordinator = null
    }
    if (this.isCoordinator) {
      const newCoordinator = this.members()[0]
      if (newCoordinator) {
        newCoordinator.becomePlatformCoordinator()
        this.leaving = true
        return this.abandon(newCoordinator, callback)
      }
      return callback()
    }
    this.leaving = true
    return this.leave(callback)
  }
}

// Called by homebridge when characteristic is changed from homekit.
ZpAccessory.prototype.setZoneVolume = function (volume, callback) {
  if (this.state.zone.volume === volume) {
    return callback()
  }
  this.log.info('%s: volume changed from %s to %s', this.name, this.state.zone.volume, volume)
  this.zp.setVolume(volume + '', (err, data) => {
    if (err) {
      this.log.error('%s: set volume: %s', this.name, err)
      return callback(err)
    }
    // this.state.zone.volume = volume
    return callback()
  })
}

// Called by homebridge when characteristic is changed from homekit.
ZpAccessory.prototype.setZoneChangeVolume = function (volume, callback, reset = true) {
  if (volume === 0) {
    return callback()
  }
  if (reset) {
    setTimeout(() => {
      this.log.debug('%s: reset volume change to 0', this.name)
      this.zoneService.updateCharacteristic(my.Characteristic.ChangeVolume, 0)
    }, this.platform.resetTimeout)
  }
  this.log.info('%s: volume change %s', this.name, volume)
  const newVolume = Math.min(Math.max(this.state.zone.volume + volume, 0), 100)
  this.setZoneVolume(newVolume, callback)
}

// Called by homebridge when characteristic is changed from homekit.
ZpAccessory.prototype.setZoneMute = function (mute, callback) {
  mute = !!mute
  if (this.state.zone.mute === mute) {
    return callback()
  }
  this.log.info('%s: mute changed from %s to %s', this.name, this.state.zone.mute, mute)
  this.zp.setMuted(mute, (err, data) => {
    if (err) {
      this.log.error('%s: set mute: %s', this.name, err)
      return callback(err)
    }
    this.state.zone.mute = mute
    return callback()
  })
}

// Called by homebridge when characteristic is changed from homekit.
ZpAccessory.prototype.setZoneBalance = function (balance, callback) {
  if (this.state.zone.balance === balance) {
    return callback()
  }
  this.log.info('%s: balance changed from %s to %s', this.name, this.state.zone.balance, balance)
  const oldLeft = this.state.zone.balance > 0 ? 100 - this.state.zone.balance : 100
  const oldRight = this.state.zone.balance < 0 ? 100 + this.state.zone.balance : 100
  const left = balance > 0 ? 100 - balance : 100
  const right = balance < 0 ? 100 + balance : 100
  if (oldLeft !== left) {
    const args = {
      InstanceID: 0,
      Channel: 'LF',
      DesiredVolume: left + ''
    }
    this.log.debug('%s: set volume LF from %s to %s', this.name, oldLeft, left)
    this.renderingControl._request('SetVolume', args, (err, status) => {
      if (err) {
        this.log.error('%s: set volume LF: %s', this.name, err)
        return callback(err)
      }
      if (oldRight !== right) {
        const args = {
          InstanceID: 0,
          Channel: 'RF',
          DesiredVolume: right + ''
        }
        this.log.debug('%s: set volume RF from %s to %s', this.name, oldRight, right)
        this.renderingControl._request('SetVolume', args, (err, status) => {
          if (err) {
            this.log.error('%s: set volume RF: %s', this.name, err)
            return callback(err)
          }
          this.state.zone.balance = balance
          return callback()
        })
      } else {
        this.state.zone.balance = balance
        return callback()
      }
    })
  } else if (oldRight !== right) {
    const args = {
      InstanceID: 0,
      Channel: 'RF',
      DesiredVolume: right + ''
    }
    this.log.debug('%s: set volume RF from %s to %s', this.name, oldRight, right)
    this.renderingControl._request('SetVolume', args, (err, status) => {
      if (err) {
        this.log.error('%s: set volume RF: %s', this.name, err)
        return callback(err)
      }
      this.state.zone.balance = balance
      return callback()
    })
  }
}

// Called by homebridge when characteristic is changed from homekit.
ZpAccessory.prototype.setZoneBass = function (bass, callback) {
  if (this.state.zone.bass === bass) {
    return callback()
  }
  this.log.info('%s: bass changed from %s to %s', this.name, this.state.zone.bass, bass)
  const args = {
    InstanceID: 0,
    DesiredBass: bass + ''
  }
  this.renderingControl._request('SetBass', args, (err, status) => {
    if (err) {
      this.log.error('%s: set bass: %s', this.name, err)
      return callback(err)
    }
    this.state.zone.bass = bass
    return callback()
  })
}

// Called by homebridge when characteristic is changed from homekit.
ZpAccessory.prototype.setZoneTreble = function (treble, callback) {
  if (this.state.zone.treble === treble) {
    return callback()
  }
  this.log.info('%s: treble changed from %s to %s', this.name, this.state.zone.treble, treble)
  const args = {
    InstanceID: 0,
    DesiredTreble: treble + ''
  }
  this.renderingControl._request('SetTreble', args, (err, status) => {
    if (err) {
      this.log.error('%s: set treble: %s', this.name, err)
      return callback(err)
    }
    this.state.zone.treble = treble
    return callback()
  })
}

// Called by homebridge when characteristic is changed from homekit.
ZpAccessory.prototype.setZoneLoudness = function (loudness, callback) {
  loudness = !!loudness
  if (this.state.zone.loudness === loudness) {
    return callback()
  }
  this.log.info('%s: loudness changed from %s to %s', this.name, this.state.zone.loudness, loudness)
  const args = {
    InstanceID: 0,
    Channel: 'Master',
    DesiredLoudness: loudness ? '1' : '0'
  }
  this.renderingControl._request('SetLoudness', args, (err, status) => {
    if (err) {
      this.log.error('%s: set loudness: %s', this.name, err)
      return callback(err)
    }
    this.state.zone.loudness = loudness
    return callback()
  })
}

// Called by homebridge when characteristic is changed from homekit.
ZpAccessory.prototype.setZoneNightSound = function (nightSound, callback) {
  nightSound = !!nightSound
  if (this.state.zone.nightSound === nightSound) {
    return callback()
  }
  this.log.info('%s: night sound changed from %s to %s', this.name, this.state.zone.nightSound, nightSound)
  const args = {
    InstanceID: 0,
    EQType: 'NightMode',
    DesiredValue: nightSound ? '1' : '0'
  }
  this.renderingControl._request('SetEQ', args, (err, status) => {
    if (err) {
      this.log.error('%s: set night mode: %s', this.name, err)
      return callback(err)
    }
    this.state.zone.nightSound = nightSound
    return callback()
  })
}

// Called by homebridge when characteristic is changed from homekit.
ZpAccessory.prototype.setZoneSpeechEnhancement = function (speechEnhancement, callback) {
  speechEnhancement = !!speechEnhancement
  if (this.state.zone.speechEnhancement === speechEnhancement) {
    return callback()
  }
  this.log.info('%s: speech enhancement changed from %s to %s', this.name, this.state.zone.speechEnhancement, speechEnhancement)
  const args = {
    InstanceID: 0,
    EQType: 'DialogLevel',
    DesiredValue: speechEnhancement ? '1' : '0'
  }
  this.renderingControl._request('SetEQ', args, (err, status) => {
    if (err) {
      this.log.error('%s: set speech enhancement: %s', this.name, err)
      return callback(err)
    }
    this.state.zone.speechEnhancement = speechEnhancement
    return callback()
  })
}

// Called by homebridge when characteristic is changed from homekit.
ZpAccessory.prototype.setGroupOn = function (on, callback) {
  on = !!on
  if (this.state.group.on === on) {
    return callback()
  }
  this.log.info(
    '%s: %s (play/pause) changed from %s to %s', this.name,
    this.platform.tv ? 'active' : 'power', this.state.group.on, on
  )
  if (!this.isCoordinator) {
    return this.coordinator.setGroupOn(on, callback)
  }
  if (on && this.state.group.currentTransportActions.includes('Play') && this.state.group.track !== 'TV') {
    this.log.debug('%s: play', this.name)
    this.zp.play((err, success) => {
      if (err || !success) {
        this.log.error('%s: play: %s', this.name, err)
        return callback(err)
      }
      // this.state.group.on = on
      // TODO: copy members
      return callback()
    })
  } else if (!on && this.state.group.currentTransportActions.includes('Pause')) {
    this.log.debug('%s: pause', this.name)
    this.zp.pause((err, success) => {
      if (err || !success) {
        this.log.error('%s: pause: %s', this.name, err)
        return callback(err)
      }
      // this.state.group.on = on
      // TODO: copy members
      return callback()
    })
  } else if (!on && this.state.group.currentTransportActions.includes('Stop')) {
    this.log.debug('%s: stop', this.name)
    this.zp.stop((err, success) => {
      if (err || !success) {
        this.log.error('%s: stop: %s', this.name, err)
        return callback(err)
      }
      // this.state.group.on = on
      // TODO: copy members
      return callback()
    })
  } else {
    this.log.debug('%s: play/pause not available', this.name)
    setTimeout(() => {
      this.log.debug('%s: reset play/pause to %j', this.name, this.state.group.on)
      if (this.platform.tv) {
        const active = this.state.group.on ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE
        this.groupService.updateCharacteristic(Characteristic.Active, active)
      } else {
        this.groupService.updateCharacteristic(Characteristic.On, this.state.group.on)
      }
    }, this.platform.resetTimeout)
    return callback()
  }
}

// Called by homebridge when characteristic is changed from homekit.
ZpAccessory.prototype.setGroupVolume = function (volume, callback) {
  if (this.state.group.volume === volume) {
    return callback()
  }
  this.log.info('%s: group volume changed from %s to %s', this.name, this.state.group.volume, volume)
  if (!this.isCoordinator) {
    return this.coordinator.setGroupVolume(volume, callback)
  }
  const args = {
    InstanceID: 0,
    DesiredVolume: volume + ''
  }
  this.groupRenderingControl._request('SetGroupVolume', args, (err, status) => {
    if (err) {
      this.log.error('%s: set group volume: %s', this.name, err)
      return callback(err)
    }
    // this.state.group.volume = volume
    // TODO: copy members
    return callback()
  })
}

// Called by homebridge when characteristic is changed from homekit.
ZpAccessory.prototype.setGroupChangeVolume = function (volume, callback, reset = true) {
  if (volume === 0) {
    return callback()
  }
  if (reset) {
    setTimeout(() => {
      this.log.debug('%s: reset group volume change to 0', this.name)
      this.groupService.updateCharacteristic(my.Characteristic.ChangeVolume, 0)
    }, this.platform.resetTimeout)
  }
  this.log.info('%s: group volume change %s', this.name, volume)
  const newVolume = Math.min(Math.max(this.state.group.volume + volume, 0), 100)
  this.setGroupVolume(newVolume, callback)
}

// Called by homebridge when characteristic is changed from homekit.
ZpAccessory.prototype.setGroupMute = function (mute, callback) {
  mute = !!mute
  if (this.state.group.mute === mute) {
    return callback()
  }
  this.log.info('%s: group mute changed from %s to %s', this.name, this.state.group.mute, mute)
  if (!this.isCoordinator) {
    return this.coordinator.setGroupMute(mute, callback)
  }
  this.log.debug('%s: set group mute to ', this.name, mute)
  const args = {
    InstanceID: 0,
    DesiredMute: mute
  }
  this.groupRenderingControl._request('SetGroupMute', args, (err, status) => {
    if (err) {
      this.log.error('%s: set group mute: %s', this.name, err)
      return callback(err)
    }
    // this.state.group.mute = mute
    // TODO: copy members
    return callback()
  })
}

// Called by homebridge when characteristic is changed from homekit.
// ZpAccessory.prototype.setGroupChangeInput = function (input, callback) {
//   if (input === 0) {
//     return callback()
//   }
//   setTimeout(() => {
//     this.log.debug('%s: reset group input change to 0', this.name)
//     this.groupService.updateCharacteristic(my.Characteristic.ChangeInput, 0)
//   }, this.platform.resetTimeout)
//   this.log.info('%s: group input change %s', this.name, input)
//   if (!this.isCoordinator) {
//     return this.coordinator.setGroupChangeInput(input, callback)
//   }
//   this.log.debug('%s: input change not yet implemented', this.name)
//   return callback()
// }

// Called by homebridge when characteristic is changed from homekit.
ZpAccessory.prototype.setGroupChangeTrack = function (track, callback, reset = true) {
  if (track === 0) {
    return callback()
  }
  if (reset) {
    setTimeout(() => {
      this.log.debug('%s: reset group track change to 0', this.name)
      this.groupService.updateCharacteristic(my.Characteristic.ChangeTrack, 0)
    }, this.platform.resetTimeout)
  }
  this.log.info('%s: group track change %s', this.name, track)
  if (!this.isCoordinator) {
    return this.coordinator.setGroupChangeTrack(track, callback)
  }
  if (track > 0 && this.state.group.currentTransportActions.includes('Next')) {
    this.log.debug('%s: next track', this.name)
    this.zp.next((err, success) => {
      if (err) {
        this.log.error('%s: next track: %s', this.name, err)
        return callback(err)
      }
      return callback()
    })
  } else if (track < 0 && this.state.group.currentTransportActions.includes('Previous')) {
    this.log.debug('%s: previous track', this.name)
    this.zp.previous((err, success) => {
      if (err) {
        this.log.error('%s: previous track: %s', this.name, err)
        return callback(err)
      }
      return callback()
    })
  } else {
    this.log.debug('%s: next/previous track not available', this.name)
    return callback()
  }
}

// Called by homebridge when characteristic is changed from homekit.
ZpAccessory.prototype.setGroupSonosCoordinator = function (on, callback) {
  on = !!on
  if (on && this.platform.coordinator === this) {
    return callback()
  }
  this.zoneService.updateCharacteristic(Characteristic.On, false)
  this.setZoneOn(false, () => {
    this.platform.coordinator = null
    if (on) {
      this.becomePlatformCoordinator()
    }
    return callback()
  })
}

// Called by homebridge when characteristic is read from homekit.
ZpAccessory.prototype.getLightOn = function (callback) {
  this.zp.getLEDState((err, on) => {
    if (err) {
      this.log.error('%s: get led state: %s', this.name, err)
      return callback(err)
    }
    const newOn = on === 'On'
    if (newOn !== this.state.light.on) {
      this.log.debug('%s: set led on from %s to %s', this.name, this.state.light.on, newOn)
      this.state.light.on = newOn
    }
    return callback(null, this.state.light.on)
  })
}

// Called by homebridge when characteristic is changed from homekit.
ZpAccessory.prototype.setLightOn = function (on, callback) {
  if (this.state.zone.lightOn === on) {
    return callback()
  }
  this.log.info('%s: led on changed from %s to %s', this.name, this.state.light.on, on)
  this.zp.setLEDState(on ? 'On' : 'Off', (err) => {
    if (err) {
      this.log.error('%s: set led state: %s', this.name, err)
      return callback(err)
    }
    this.state.light.on = on
    return callback()
  })
}

// ===== SONOS INTERACTION =====================================================

// Join a group.
ZpAccessory.prototype.join = function (coordinator, callback) {
  this.log.debug('%s: join %s', this.name, coordinator.name)
  const args = {
    InstanceID: 0,
    CurrentURI: 'x-rincon:' + coordinator.zp.id,
    CurrentURIMetaData: null
  }
  this.avTransport.SetAVTransportURI(args, (err, status) => {
    if (err) {
      this.log.error('%s: join %s: %s', this.name, coordinator.name, err)
      return callback(err)
    }
    return callback()
  })
}

// Leave a group.
ZpAccessory.prototype.leave = function (callback) {
  const oldGroup = this.coordinator.name
  this.log.debug('%s: leave %s', this.name, oldGroup)
  const args = {
    InstanceID: 0
  }
  this.avTransport.BecomeCoordinatorOfStandaloneGroup(args, (err, status) => {
    if (err) {
      this.log.error('%s: leave %s: %s', this.name, oldGroup, err)
      return callback(err)
    }
    return callback()
  })
}

// Transfer ownership and leave a group.
ZpAccessory.prototype.abandon = function (newCoordinator, callback) {
  const oldGroup = this.coordinator.name
  this.log.debug('%s: leave %s to %s', this.name, oldGroup, newCoordinator.name)
  const args = {
    InstanceID: 0,
    NewCoordinator: newCoordinator.zp.id,
    RejoinGroup: false
  }
  this.avTransport.DelegateGroupCoordinationTo(args, (err, status) => {
    if (err) {
      this.log.error('%s: leave %s to %s: %s', this.name, oldGroup, newCoordinator.name, err)
      return callback(err)
    }
    return callback()
  })
}

// Subscribe to Sonos ZonePlayer events
ZpAccessory.prototype.subscribe = function (service, callback) {
  if (this.platform.shuttingDown) {
    return callback()
  }
  const subscribeUrl = 'http://' + this.zp.host + ':' + this.zp.port + '/' +
                       service + '/Event'
  const callbackUrl = this.platform.callbackUrl + '/' + this.zp.id + '/' + service
  const opt = {
    url: subscribeUrl,
    method: 'SUBSCRIBE',
    headers: {
      CALLBACK: '<' + callbackUrl + '>',
      NT: 'upnp:event',
      TIMEOUT: 'Second-' + this.platform.subscriptionTimeout
    }
  }
  this.request(opt, (err, response) => {
    if (err) {
      return callback(err)
    }
    this.log.debug(
      '%s: new %s subscription %s (timeout %s)', this.name,
      service, response.headers.sid, response.headers.timeout
    )
    this.subscriptions[service] = response.headers.sid
    if (this.platform.shuttingDown) {
      this.unsubscribe(response.headers.sid, service)
      return callback()
    }
    setTimeout(() => {
      this.resubscribe(response.headers.sid, service)
    }, (this.platform.subscriptionTimeout - 60) * 1000)
    return callback()
  })
}

// Cancel subscription to Sonos ZonePlayer events
ZpAccessory.prototype.unsubscribe = function (sid, service) {
  const subscribeUrl = 'http://' + this.zp.host + ':' + this.zp.port + '/' +
                       service + '/Event'
  const opt = {
    url: subscribeUrl,
    method: 'UNSUBSCRIBE',
    headers: {
      SID: sid
    }
  }
  this.request(opt, (err, response) => {
    if (err) {
      this.log.error('%s: cancel %s subscription %s: %s', this.name, service, sid, err)
      return
    }
    this.log.debug(
      '%s: cancelled %s subscription %s', this.name, service, sid
    )
    delete this.subscriptions[service]
  })
}

// Renew subscription to Sonos ZonePlayer events
ZpAccessory.prototype.resubscribe = function (sid, service) {
  if (this.platform.shuttingDown || sid !== this.subscriptions[service]) {
    return
  }
  this.log.debug('%s: renewing %s subscription %s', this.name, service, sid)
  const subscribeUrl = 'http://' + this.zp.host + ':' + this.zp.port + '/' +
                       service + '/Event'
  const opt = {
    url: subscribeUrl,
    method: 'SUBSCRIBE',
    headers: {
      SID: sid,
      TIMEOUT: 'Second-' + this.platform.subscriptionTimeout
    }
  }
  this.request(opt, (err, response) => {
    if (err) {
      this.log.error('%s: renew %s subscription %s: %s', this.name, service, sid, err)
      this.subscribe(service, (err) => {
        this.log.error('%s: subscribe to %s events: %s', this.name, service, err)
      })
      return
    }
    this.log.debug(
      '%s: renewed %s subscription %s (timeout %s)', this.name,
      service, response.headers.sid, response.headers.timeout
    )
    if (this.platform.shuttingDown) {
      this.unsubscribe(response.headers.sid, service)
      return
    }
    setTimeout(() => {
      this.resubscribe(response.headers.sid, service)
    }, (this.platform.subscriptionTimeout - 60) * 1000)
  })
}

// Send request to Sonos ZonePlayer.
ZpAccessory.prototype.request = function (opt, callback) {
  this.log.debug('%s: %s %s', this.name, opt.method, opt.url)
  request(opt, (err, response) => {
    if (err) {
      this.log.error('%s: cannot %s %s (%s)', this.name, opt.method, opt.url, err)
      return callback(err)
    }
    if (response.statusCode !== 200) {
      this.log.error(
        '%s: cannot %s %s (%d - %s)', this.name, opt.method, opt.url,
        response.statusCode, response.statusMessage
      )
      return callback(response.statusCode)
    }
    return callback(null, response)
  })
}
