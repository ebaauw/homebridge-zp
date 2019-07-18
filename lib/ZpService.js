// homebridge-zp/lib/ZpAccessory.js
// Copyright © 2016-2019 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

const homebridgeLib = require('homebridge-lib')

class ZpService extends homebridgeLib.ServiceDelegate {
  constructor (zpAccessory, params) {
    super(zpAccessory, params)
    this.zpAccessory = zpAccessory
    this.zpClient = this.zpAccessory.zpClient
  }

  static get Sonos () { return Sonos }
  static get Speaker () { return Speaker }
  static get Led () { return Led }
  static get Alarm () { return Alarm }
  static get Tv () { return Tv }
}

class Sonos extends ZpService {
  constructor (zpAccessory, params = {}) {
    params.name = zpAccessory.platform.config.nameScheme.replace('%', zpAccessory.zpClient.zoneName)
    params.Service = zpAccessory.platform.config.SpeakerService
    params.subtype = 'group'
    super(zpAccessory, params)
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
    this.addCharacteristic({
      key: 'on',
      Characteristic: this.Characteristic.hap.On,
      setter: async (value) => {
        try {
          if (value === this.values.on) {
            return
          }
          if (
            value &&
            this.values.currentTransportActions.includes('Play') &&
            this.values.currentTrack !== 'TV'
          ) {
            await this.zpAccessory.coordinator.zpClient.play()
          } else if (
            !value &&
            this.values.currentTransportActions.includes('Pause')
          ) {
            await this.zpAccessory.coordinator.zpClient.pause()
          } else if (
            !value &&
            this.values.currentTransportActions.includes('Stop')
          ) {
            await this.zpAccessory.coordinator.zpClient.stop()
          } else {
            setTimeout(() => {
              this.values.on = !value
            }, this.platform.config.resetTimeout)
          }
        } catch (error) {
          this.error(error)
        }
      }
    })
    this.addCharacteristic({
      key: 'volume',
      Characteristic: this.platform.config.VolumeCharacteristic,
      unit: '%',
      setter: async (value) => {
        try {
          await this.zpAccessory.coordinator.zpClient.setGroupVolume(value)
        } catch (error) {
          this.error(error)
        }
      }
    })
    this.addCharacteristic({
      key: 'changeVolume',
      Characteristic: this.Characteristic.my.ChangeVolume,
      value: 0,
      setter: async (value) => {
        try {
          await this.zpAccessory.coordinator.zpClient.setRelativeGroupVolume(value)
        } catch (error) {
          this.error(error)
        }
        setTimeout(() => {
          this.values.changeVolume = 0
        }, this.platform.config.resetTimeout)
      }
    })
    this.addCharacteristic({
      key: 'mute',
      Characteristic: this.Characteristic.hap.Mute,
      setter: async (value) => {
        try {
          await this.zpAccessory.coordinator.zpClient.setGroupMute(value)
        } catch (error) {
          this.error(error)
        }
      }
    })
    this.addCharacteristic({
      key: 'currentTrack',
      Characteristic: this.Characteristic.my.CurrentTrack
    })
    this.addCharacteristic({
      key: 'changeTrack',
      Characteristic: this.Characteristic.my.ChangeTrack,
      value: 0,
      setter: async (value) => {
        try {
          if (
            value > 0 &&
            this.values.currentTransportActions.includes('Next')
          ) {
            await this.zpAccessory.coordinator.zpClient.next()
          } else if (
            value < 0 &&
            this.values.currentTransportActions.includes('Previous')
          ) {
            await this.zpAccessory.coordinator.zpClient.previous()
          }
        } catch (error) {
          this.error(error)
        }
        setTimeout(() => {
          this.values.changeTrack = 0
        }, this.platform.config.resetTimeout)
      }
    })
    if (this.zpClient.tvIn) {
      this.addCharacteristic({
        key: 'tv',
        Characteristic: this.Characteristic.my.Tv
      })
    }
    this.addCharacteristic({
      key: 'sonosGroup',
      Characteristic: this.Characteristic.my.SonosGroup
    })
    this.addCharacteristic({
      key: 'sonosCoordinator',
      Characteristic: this.Characteristic.my.SonosCoordinator,
      value: false,
      setter: async (value) => {
        try {
          if (value) {
            this.zpAccessory.becomePlatformCoordinator()
          } else {
            if (this.zpAccessory.speakerService != null) {
              this.zpAccessory.speakerService.values.on = false
            }
            this.platform.coordinator = null
          }
        } catch (error) {
          this.error(error)
        }
      }
    })
    zpAccessory.once('groupInitialised', () => {
      this.zpClient.subscribe('/MediaRenderer/AVTransport/Event')
        .catch((error) => {
          this.error(error)
        })
      this.zpClient.subscribe('/MediaRenderer/GroupRenderingControl/Event')
        .catch((error) => {
          this.error(error)
        })
    })
  }

  handleMediaRendererAVTransportEvent (payload) {
    if (
      payload.lastChange == null ||
      !Array.isArray(payload.lastChange) ||
      payload.lastChange[0] == null
    ) {
      return
    }
    const event = payload.lastChange[0]
    let on
    let tv
    let track
    let currentTransportActions
    const state = event.transportState
    if (state != null && this.values.currentTrack !== 'TV') {
      if (state === 'PLAYING') {
        on = true
      } else if (state === 'PAUSED_PLAYBACK' || state === 'STOPPED') {
        on = false
      }
    }
    const meta = event.currentTrackMetaData
    // this.debug('currentTrackMetaData: %j', meta)
    if (meta != null && meta.res != null) {
      switch (meta.res._.split(':')[0]) {
        case 'x-rincon-stream': // Line in input.
          track = meta.title
          break
        case 'x-sonos-htastream': // SPDIF TV input.
          track = 'TV'
          on = meta.streamInfo !== 0 // 0: no input; 2: stereo; 18: Dolby 5.1; 22: ?
          tv = on
          break
        case 'x-sonosapi-vli': // Airplay2.
          track = 'Airplay2'
          break
        case 'aac': // Radio stream (e.g. DI.fm)
        case 'x-sonosapi-stream': // Radio stream.
        case 'x-rincon-mp3radio': // AirTunes (by homebridge-zp).
          track = meta.streamContent // info
          if (track === '') {
            if (event.enqueuedTransportUriMetaData != null) {
              track = event.enqueuedTransportUriMetaData.title // station
            }
          }
          break
        case 'x-file-cifs': // Library song.
        case 'x-sonos-http': // See issue #44.
        case 'http': // Song on iDevice.
        case 'https': // Apple Music, see issue #68
        case 'x-sonos-spotify': // Spotify song.
          if (meta.title != null) {
            track = meta.title // song
          }
          break
        case 'x-sonosapi-hls': // ??
        case 'x-sonosapi-hls-static': // e.g. Amazon Music
          // Skip! update will arrive in subsequent CurrentTrackMetaData events
          // and will be handled by default case
          break
        case 'x-rincon-buzzer':
          track = 'Sonos Chime'
          break
        default:
          if (meta.title != null) {
            track = meta.title // song
          } else {
            track = ''
          }
          break
      }
    }
    if (event.currentTransportActions != null && this.values.currentTrack !== 'TV') {
      currentTransportActions = event.currentTransportActions.split(', ')
      if (currentTransportActions.length === 1) {
        track = ''
      }
    }
    if (on != null) {
      this.values.on = on
      for (const member of this.zpAccessory.members()) {
        member.sonosService.values.on = this.values.on
      }
    }
    if (
      track != null &&
      track !== 'ZPSTR_CONNECTING' && track !== 'ZPSTR_BUFFERING'
    ) {
      this.values.currentTrack = track
      for (const member of this.zpAccessory.members()) {
        member.sonosService.values.currentTrack = this.values.currentTrack
      }
    }
    if (tv != null) {
      if (tv !== this.values.tv) {
        if (tv || this.values.tv == null) {
          this.values.tv = tv
        } else {
          this.tvTimer = setTimeout(() => {
            this.tvTimer = null
            this.values.tv = tv
          }, 10000)
        }
      } else if (this.tvTimer != null) {
        clearTimeout(this.tvTimer)
        this.tvTimer = null
      }
    }
    if (currentTransportActions != null) {
      this.values.currentTransportActions = currentTransportActions
      for (const member of this.zpAccessory.members()) {
        member.sonosService.values.currentTransportActions =
          this.values.currentTransportActions
      }
    }
  }

  handleMediaRendererGroupRenderingControlEvent (event) {
    if (event.groupVolumeChangeable === 1) {
      this.zpAccessory.coordinator = this.zpAccessory
      this.zpAccessory.leaving = false
    }
    if (event.groupVolume != null) {
      this.values.volume = event.groupVolume
      for (const member of this.zpAccessory.members()) {
        member.sonosService.values.volume = this.values.volume
      }
    }
    if (event.groupMute != null) {
      this.values.mute = !!event.groupMute
      for (const member of this.zpAccessory.members()) {
        member.sonosService.values.mute = this.values.mute
      }
    }
  }
}

class Speaker extends ZpService {
  constructor (zpAccessory, params = {}) {
    params.name = zpAccessory.zpClient.zoneName + ' Speakers'
    params.Service = zpAccessory.platform.config.SpeakerService
    params.subtype = 'zone'
    super(zpAccessory, params)
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
    this.addCharacteristic({
      key: 'on',
      Characteristic: this.Characteristic.hap.On,
      setter: async (value) => {
        try {
          if (value === this.values.on) {
            return
          }
          this.values.on = value
          if (value) {
            const coordinator = this.platform.coordinator
            if (coordinator) {
              return this.zpClient.setAvTransportGroup(coordinator.zpClient.id)
            }
            return this.zpAccessory.becomePlatformCoordinator()
          }
          if (this.platform.coordinator === this.zpAccessory) {
            this.platform.coordinator = null
          }
          if (this.isCoordinator) {
            const newCoordinator = this.zpAccessory.members()[0]
            if (newCoordinator != null) {
              newCoordinator.becomePlatformCoordinator()
              this.zpAccessory.leaving = true
              return this.zpClient.delegateGroupCoordinationTo(
                newCoordinator.zpClient.id
              )
            }
          }
          this.zpAccessory.leaving = true
          return this.zpClient.becomeCoordinatorOfStandaloneGroup()
        } catch (error) {
          this.error(error)
        }
      }
    })
    this.addCharacteristic({
      key: 'volume',
      Characteristic: this.platform.config.VolumeCharacteristic,
      unit: '%',
      setter: this.zpClient.setVolume.bind(this.zpClient)
    })
    this.addCharacteristic({
      key: 'changeVolume',
      Characteristic: this.Characteristic.my.ChangeVolume,
      value: 0,
      setter: async (value) => {
        try {
          await this.zpClient.setRelativeVolume(value)
        } catch (error) {
          this.error(error)
        }
        setTimeout(() => {
          this.values.changeVolume = 0
        }, this.platform.config.resetTimeout)
      }
    })
    this.addCharacteristic({
      key: 'mute',
      Characteristic: this.Characteristic.hap.Mute,
      setter: this.zpClient.setMute.bind(this.zpClient)
    })
    this.addCharacteristic({
      key: 'loudness',
      Characteristic: this.Characteristic.my.Loudness,
      setter: this.zpClient.setLoudness.bind(this.zpClient)
    })
    this.addCharacteristic({
      key: 'bass',
      Characteristic: this.Characteristic.my.Bass,
      setter: this.zpClient.setBass.bind(this.zpClient)
    })
    this.addCharacteristic({
      key: 'treble',
      Characteristic: this.Characteristic.my.Treble,
      setter: this.zpClient.setTreble.bind(this.zpClient)
    })
    if (this.zpClient.balance) {
      this.addCharacteristic({
        key: 'balance',
        Characteristic: this.Characteristic.my.Balance,
        unit: '%',
        setter: this.zpClient.setBalance.bind(this.zpClient)
      })
    }
    if (this.zpClient.tvIn) {
      this.addCharacteristic({
        key: 'nightSound',
        Characteristic: this.Characteristic.my.NightSound,
        setter: this.zpClient.setNightSound.bind(this.zpClient)
      })
      this.addCharacteristic({
        key: 'speechEnhancement',
        Characteristic: this.Characteristic.my.SpeechEnhancement,
        setter: this.zpClient.setSpeechEnhancement.bind(this.zpClient)
      })
    }
    this.zpClient.subscribe('/MediaRenderer/RenderingControl/Event')
      .catch((error) => {
        this.error(error)
      })
  }

  handleMediaRendererRenderingControlEvent (payload) {
    if (
      payload.lastChange == null ||
      !Array.isArray(payload.lastChange) ||
      payload.lastChange[0] == null
    ) {
      return
    }
    const event = payload.lastChange[0]
    if (event.volume != null && event.volume.master != null) {
      this.values.volume = event.volume.master
      if (
        this.zpClient.balance &&
        event.volume.lf != null && event.volume.rf != null
      ) {
        this.values.balance = event.volume.rf - event.volume.lf
      }
    }
    if (event.mute != null && event.mute.master != null) {
      this.values.mute = !!event.mute.master
    }
    if (event.loudness != null && event.loudness.master != null) {
      this.values.loudness = !!event.loudness.master
    }
    if (event.bass != null) {
      this.values.bass = event.bass
    }
    if (event.treble != null) {
      this.values.treble = event.treble
    }
    if (event.nightMode != null) {
      this.values.nightSound = !!event.nightMode
    }
    if (event.dialogLevel != null) {
      this.values.speechEnhancement = !!event.dialogLevel
    }
  }
}

class Led extends ZpService {
  constructor (zpAccessory, zpClient) {
    const params = {
      name: zpClient.zoneName + ' Sonos LED',
      Service: zpAccessory.Service.hap.Lightbulb,
      subtype: 'led' + (zpClient.channel == null ? '' : zpClient.channel)
    }
    if (zpClient.role !== 'master') {
      params.name += ' (' + zpClient.channel + ')'
    }
    super(zpAccessory, params)
    const paramsOn = {
      key: 'on',
      Characteristic: this.Characteristic.hap.On,
      setter: this.zpClient.setLedState.bind(this.zpClient)
    }
    const paramsLocked = {
      key: 'locked',
      Characteristic: this.Characteristic.my.Locked,
      setter: this.zpClient.setButtonLockState.bind(this.zpClient)
    }
    if (!(this.platform.config.heartrate > 0)) {
      this.debug('setting up getters')
      paramsOn.getter = this.zpClient.getLedState.bind(this.zpClient)
      paramsLocked.getter = async (value) => {
        return (await this.zpClient.getButtonLockState())
          ? this.Characteristic.hap.LockPhysicalControls.CONTROL_LOCK_ENABLED
          : this.Characteristic.hap.LockPhysicalControls.CONTROL_LOCK_DISABLED
      }
    }
    this.addCharacteristic(paramsOn)
    this.addCharacteristic(paramsLocked)
    if (this.platform.config.heartrate > 0) {
      this.debug('setting up heartbeat')
      this.zpAccessory.on('heartbeat', async (beat) => {
        try {
          if (beat % this.platform.config.heartrate === 0) {
            if (!this.zpAccessory.blinking) {
              this.values.on = await this.zpClient.getLedState()
            }
            this.values.locked = (await this.zpClient.getButtonLockState())
              ? this.Characteristic.hap.LockPhysicalControls.CONTROL_LOCK_ENABLED
              : this.Characteristic.hap.LockPhysicalControls.CONTROL_LOCK_DISABLED
          }
        } catch (error) {
          this.error(error)
        }
      })
    }
  }
}

class Alarm extends ZpService {
  constructor (zpAccessory, alarm) {
    const params = {
      id: alarm.id,
      name: zpAccessory.zpClient.zoneName + ' Sonos Alarm ' + alarm.id,
      Service: zpAccessory.Service.hap.Switch,
      subtype: 'alarm' + alarm.id
    }
    super(zpAccessory, params)
    this.addCharacteristic({
      key: 'on',
      Characteristic: this.Characteristic.hap.On,
      setter: async (value) => {
        const alarm = Object.assign({}, this._alarm)
        alarm.enabled = value ? 1 : 0
        return this.zpClient.updateAlarm(alarm)
      }
    })
    this.addCharacteristic({
      'key': 'currentTrack',
      Characteristic: this.Characteristic.my.CurrentTrack
    })
    this.addCharacteristic({
      'key': 'time',
      Characteristic: this.Characteristic.my.Time
    })
    this.alarm = alarm
  }

  get alarm () { return this._alarm }
  set alarm (alarm) {
    this._alarm = alarm
    this.values.on = alarm.enabled === 1
    this.values.currentTrack = alarm.programUri === 'x-rincon-buzzer:0'
      ? 'Sonos Chime'
      : alarm.programMetaData != null && alarm.programMetaData.title != null
        ? alarm.programMetaData.title
        : 'unknown'
    this.values.time = alarm.startTime
  }
}

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

class Tv extends ZpService {
  constructor (zpAccessory, params = {}) {
    params.name = zpAccessory.platform.config.nameScheme.replace('%', zpAccessory.zpClient.zoneName)
    params.Service = zpAccessory.Service.hap.Television
    params.subtype = 'tv'
    super(zpAccessory, params)
    init(this.Characteristic.hap)
    this.sonosService = this.zpAccessory.sonosService
    this.sonosValues = this.sonosService.values
    this.inputSources = {}
    this.displayOrder = []
    this.addCharacteristic({
      key: 'configuredName',
      Characteristic: this.Characteristic.hap.ConfiguredName,
      value: this.name
    })
    this.addCharacteristic({
      key: 'active',
      Characteristic: this.Characteristic.hap.Active,
      setter: async (value) => {
        try {
          if (value === this.values.active) {
            return
          }
          if (
            value === this.Characteristic.hap.Active.ACTIVE &&
            this.sonosValues.currentTransportActions.includes('Play') &&
            this.sonosValues.currentTrack !== 'TV'
          ) {
            await this.zpAccessory.coordinator.zpClient.play()
          } else if (
            value === this.Characteristic.hap.Active.INACTIVE &&
            this.sonosValues.currentTransportActions.includes('Pause')
          ) {
            await this.zpAccessory.coordinator.zpClient.pause()
          } else if (
            value === this.Characteristic.hap.Active.INACTIVE &&
            this.sonosValues.currentTransportActions.includes('Stop')
          ) {
            await this.zpAccessory.coordinator.zpClient.stop()
          } else {
            setTimeout(() => {
              this.values.active = 1 - value
            }, this.platform.config.resetTimeout)
          }
        } catch (error) {
          this.error(error)
        }
      }
    }).on('didSet', (value) => {
      this.sonosValues.on = value === this.Characteristic.hap.Active.ACTIVE
    })
    this.sonosService.characteristicDelegate('on').on('didSet', (value) => {
      this.values.active = value ? 1 : 0
    })
    this.addCharacteristic({
      key: 'activeIdentifier',
      Characteristic: this.Characteristic.hap.ActiveIdentifier,
      props: { maxValue: this.zpClient.tvIn ? 3 : 2 },
      value: 1
    })
    // this.sonosService.characteristicDelegate('input').on('didSet', (value) => {
    // })
    const remoteKey = this.addCharacteristic({
      key: 'remoteKey',
      Characteristic: this.Characteristic.hap.RemoteKey,
      silent: true,
      setter: async (value) => {
        this.log('%s: %s', remoteKey.displayName, remoteKeys[value])
        switch (value) {
          case this.Characteristic.hap.RemoteKey.PLAY_PAUSE:
            const value = 1 - this.values.active
            if (
              value === this.Characteristic.hap.Active.ACTIVE &&
              this.sonosValues.currentTransportActions.includes('Play') &&
              this.sonosValues.currentTrack !== 'TV'
            ) {
              return this.zpAccessory.coordinator.zpClient.play()
            } else if (
              value === this.Characteristic.hap.Active.INACTIVE &&
              this.sonosValues.currentTransportActions.includes('Pause')
            ) {
              return this.zpAccessory.coordinator.zpClient.pause()
            } else if (
              value === this.Characteristic.hap.Active.INACTIVE &&
              this.sonosValues.currentTransportActions.includes('Stop')
            ) {
              return this.zpAccessory.coordinator.zpClient.stop()
            }
            break
          case this.Characteristic.hap.RemoteKey.ARROW_LEFT:
            if (this.sonosValues.currentTransportActions.includes('Previous')) {
              return this.zpAccessory.coordinator.zpClient.previous()
            }
            break
          case this.Characteristic.hap.RemoteKey.ARROW_RIGHT:
            this.zpAccessory.sonosService.values.changeTrack = 1
            if (this.sonosValues.currentTransportActions.includes('Next')) {
              return this.zpAccessory.coordinator.zpClient.next()
            }
            break
          default:
            break
        }
      }
    })
    this.addCharacteristic({
      key: 'powerModeSelection',
      Characteristic: this.Characteristic.hap.PowerModeSelection
    })
    this.addCharacteristic({
      key: 'displayOrder',
      Characteristic: this.Characteristic.hap.DisplayOrder
    })

    this.Speaker = new ZpService.Tv.Speaker(this.zpAccessory, params)
    this.addInput({
      configuredName: 'Uno',
      identifier: 1,
      inputSourceType: this.Characteristic.hap.InputSourceType.TUNER,
      inputDeviceType: this.Characteristic.hap.InputDeviceType.AUDIO_SYSTEM
    })
    this.addInput({
      configuredName: 'Due',
      identifier: 2,
      inputSourceType: this.Characteristic.hap.InputSourceType.TUNER,
      inputDeviceType: this.Characteristic.hap.InputDeviceType.AUDIO_SYSTEM
    })
    if (this.zpClient.tvIn) {
      this.addInput({
        configuredName: 'TV',
        identifier: 3,
        inputSourceType: this.Characteristic.hap.InputSourceType.TUNER,
        inputDeviceType: this.Characteristic.hap.InputDeviceType.TV
      })
    }
    this.displayOrder.push(0x00, 0x00)
    this.values.displayOrder = Buffer.from(this.displayOrder).toString('base64')
  }

  static get Speaker () { return TvSpeaker }
  static get InputSource () { return TvInputSource }

  addInput (params) {
    const inputSource = new ZpService.Tv.InputSource(this.zpAccessory, params)
    this.inputSources[params.identifier] = inputSource
    this._service.addLinkedService(inputSource._service)
    this.displayOrder.push(0x01, 0x04, inputSource, 0x00, 0x00, 0x00)
  }
}

class TvSpeaker extends ZpService {
  constructor (zpAccessory, params = {}) {
    params.name = zpAccessory.zpClient.zoneName + ' Speakers'
    params.Service = zpAccessory.Service.hap.TelevisionSpeaker
    params.subtype = 'tvSpeaker'
    super(zpAccessory, params)
    this.addCharacteristic({
      key: 'volumeControlType',
      Characteristic: this.Characteristic.hap.VolumeControlType,
      value: this.Characteristic.hap.VolumeControlType.ABSOLUTE
    })
    const volumeSelector = this.addCharacteristic({
      key: 'volumeSelector',
      Characteristic: this.Characteristic.hap.VolumeSelector,
      silent: true,
      setter: async (value) => {
        this.log('%s: %s', volumeSelector.displayName, volumeSelectors[value])
        return this.zpClient.setRelativeVolume(
          value === this.Characteristic.hap.VolumeSelector.INCREMENT ? 1 : -1
        )
      }
    })
  }
}

class TvInputSource extends ZpService {
  constructor (zpAccessory, params = {}) {
    params.name = zpAccessory.zpClient.zoneName + ' Input ' + params.identifier
    params.Service = zpAccessory.Service.hap.InputSource
    params.subtype = 'tvInput' + params.identifier
    super(zpAccessory, params)
    this.addCharacteristic({
      key: 'configuredName',
      Characteristic: this.Characteristic.hap.ConfiguredName,
      value: params.configuredName
    })
    this.addCharacteristic({
      key: 'identifier',
      Characteristic: this.Characteristic.hap.Identifier,
      value: params.identifier
    })
    this.addCharacteristic({
      key: 'inputSourceType',
      Characteristic: this.Characteristic.hap.InputSourceType,
      value: params.inputSourceType
    })
    this.addCharacteristic({
      key: 'inputDeviceType',
      Characteristic: this.Characteristic.hap.InputDeviceType,
      value: params.inputDeviceType
    })
    this.addCharacteristic({
      key: 'isConfigured',
      Characteristic: this.Characteristic.hap.IsConfigured,
      value: this.Characteristic.hap.IsConfigured.CONFIGURED
    })
    this.addCharacteristic({
      key: 'currentVisibilityState',
      Characteristic: this.Characteristic.hap.CurrentVisibilityState,
      value: this.Characteristic.hap.CurrentVisibilityState.SHOWN
    })
  }
}

module.exports = ZpService
