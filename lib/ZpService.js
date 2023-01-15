// homebridge-zp/lib/ZpAccessory.js
// Copyright © 2016-2023 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

const he = require('he')
const homebridgeLib = require('homebridge-lib')

class ZpService extends homebridgeLib.ServiceDelegate {
  constructor (zpAccessory, params) {
    super(zpAccessory, params)
    this.zpAccessory = zpAccessory
    this.zpClient = this.zpAccessory.zpClient
    this.zpHousehold = this.zpAccessory.zpHousehold
  }

  static get Sonos () { return Sonos }

  static get Speaker () { return Speaker }

  static get Led () { return Led }

  static get Alarm () { return Alarm }

  static get Tv () { return Tv }
}

class Sonos extends ZpService {
  constructor (zpAccessory, params = {}) {
    params.name = zpAccessory.zpClient.zoneName + ' Sonos'
    params.Service = zpAccessory.platform.config.SpeakerService
    params.subtype = 'group'
    super(zpAccessory, params)
    this.debug('Sonos service')
    this.zpClient.on('message', (message) => {
      try {
        const f = `handle${message.device}${message.service}Event`
        if (this[f] != null) {
          this[f](message.parsedBody)
        }
      } catch (error) {
        this.error(error)
      }
    })
    this.addCharacteristicDelegate({
      key: 'on',
      Characteristic: this.Characteristics.hap.On,
      setter: async (value) => {
        try {
          if (value === this.values.on) {
            return
          }
          const coordinatorValues = this.zpAccessory.coordinator.sonosService.values
          if (
            value &&
            coordinatorValues.currentTransportActions.includes('Play') &&
            coordinatorValues.currentTrack !== 'TV'
          ) {
            await this.zpAccessory.coordinator.zpClient.play()
            const duration = this.values.setDuration <= 0
              ? ''
              : new Date(this.values.setDuration * 1000)
                .toISOString().slice(11, 19)
            await this.zpAccessory.coordinator.zpClient.setSleepTimer(duration)
          } else if (
            !value &&
            coordinatorValues.currentTransportActions.includes('Pause')
          ) {
            await this.zpAccessory.coordinator.zpClient.pause()
          } else if (
            !value &&
            coordinatorValues.currentTransportActions.includes('Stop')
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
      },
      timeout: 5000
    })
    this.addCharacteristicDelegate({
      key: 'setDuration',
      Characteristic: this.Characteristics.hap.SetDuration,
      silent: true,
      unit: 's',
      props: { maxValue: 86399 }, // 23:59:59
      value: 0
    }).on('didSet', (value) => {
      if (value <= 0) {
        setTimeout(() => {
          this.values.setDuration = 0
        }, this.platform.config.resetTimeout)
      }
    })
    this.addCharacteristicDelegate({
      key: 'remainingDuration',
      Characteristic: this.Characteristics.hap.RemainingDuration,
      unit: 's',
      props: { maxValue: 86399 }, // 23:59:59
      getter: async (value) => {
        try {
          if (this.zpAccessory.coordinator == null) {
            return 0
          }
          const timer = await this.zpAccessory.coordinator.zpClient.getSleepTimer()
          if (timer === '') {
            return 0
          }
          return timer.split(':').reduce((value, time) => {
            return 60 * value + +time
          })
        } catch (error) {
          this.error(error)
          return 0
        }
      },
      timeout: 2000
    })
    this.addCharacteristicDelegate({
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
    this.addCharacteristicDelegate({
      key: 'changeVolume',
      Characteristic: this.Characteristics.my.ChangeVolume,
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
    this.addCharacteristicDelegate({
      key: 'mute',
      Characteristic: this.Characteristics.hap.Mute,
      setter: async (value) => {
        try {
          await this.zpAccessory.coordinator.zpClient.setGroupMute(value)
        } catch (error) {
          this.error(error)
        }
      }
    })
    this.addCharacteristicDelegate({
      key: 'currentValidPlayModes',
      silent: true,
      value: []
    })
    this.addCharacteristicDelegate({
      key: 'repeat',
      Characteristic: this.Characteristics.my.Repeat,
      setter: async (value) => {
        try {
          const coordinatorValues = this.zpAccessory.coordinator.sonosService.values
          if (
            value === 0 || coordinatorValues.currentValidPlayModes.includes(
              value === 1 ? 'REPEATONE' : 'REPEAT'
            )
          ) {
            await this.zpAccessory.coordinator.zpClient.setRepeat(
              ['off', '1', 'on'][value]
            )
          } else {
            setTimeout(() => {
              this.values.repeat = 0
            }, this.platform.config.resetTimeout)
          }
        } catch (error) {
          this.error(error)
        }
      }
    })
    this.addCharacteristicDelegate({
      key: 'shuffle',
      Characteristic: this.Characteristics.my.Shuffle,
      setter: async (value) => {
        try {
          const coordinatorValues = this.zpAccessory.coordinator.sonosService.values
          if (!value || coordinatorValues.currentValidPlayModes.includes('SHUFFLE')) {
            await this.zpAccessory.coordinator.zpClient.setShuffle(value)
          } else {
            setTimeout(() => {
              this.values.shuffle = false
            }, this.platform.config.resetTimeout)
          }
        } catch (error) {
          this.error(error)
        }
      }
    })
    this.addCharacteristicDelegate({
      key: 'crossfade',
      Characteristic: this.Characteristics.my.Crossfade,
      setter: async (value) => {
        try {
          const coordinatorValues = this.zpAccessory.coordinator.sonosService.values
          if (!value || coordinatorValues.currentValidPlayModes.includes('CROSSFADE')) {
            await this.zpAccessory.coordinator.zpClient.setCrossfadeMode(value)
          } else {
            setTimeout(() => {
              this.values.crossfade = false
            }, this.platform.config.resetTimeout)
          }
        } catch (error) {
          this.error(error)
        }
      }
    })
    this.addCharacteristicDelegate({
      key: 'currentTrack',
      Characteristic: this.Characteristics.my.CurrentTrack
    })
    this.addCharacteristicDelegate({
      key: 'uri',
      silent: true
    })
    this.addCharacteristicDelegate({
      key: 'currentTransportActions',
      silent: true,
      value: []
    })
    this.addCharacteristicDelegate({
      key: 'changeTrack',
      Characteristic: this.Characteristics.my.ChangeTrack,
      value: 0,
      setter: async (value) => {
        try {
          const coordinatorValues = this.zpAccessory.coordinator.sonosService.values
          if (
            value > 0 &&
            coordinatorValues.currentTransportActions.includes('Next')
          ) {
            await this.zpAccessory.coordinator.zpClient.next()
          } else if (
            value < 0 &&
            coordinatorValues.currentTransportActions.includes('Previous')
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
    if (this.platform.config.tv) {
      this.addCharacteristicDelegate({
        key: 'activeIdentifier',
        Characteristic: this.Characteristics.hap.ActiveIdentifier,
        props: { maxValue: this.platform.config.maxFavourites },
        setter: async (value) => {
          this.platform.zpTvs[this.zpClient.id].tvService
            .characteristicDelegate('activeIdentifier').setValue(value)
        }
      })
      this.addCharacteristicDelegate({
        key: 'changeInput',
        Characteristic: this.Characteristics.my.ChangeInput,
        value: 0,
        setter: async (value) => {
          setTimeout(() => {
            this.values.changeInput = 0
          }, this.platform.config.resetTimeout)
        }
      })
    }
    if (this.zpClient.tvIn) {
      this.addCharacteristicDelegate({
        key: 'tv',
        Characteristic: this.Characteristics.my.Tv
      })
    }
    this.addCharacteristicDelegate({
      key: 'sonosGroup',
      Characteristic: this.Characteristics.my.SonosGroup,
      value: ''
    })
    this.addCharacteristicDelegate({
      key: 'sonosCoordinator',
      Characteristic: this.Characteristics.my.SonosCoordinator,
      value: false,
      setter: async (value) => {
        try {
          if (value) {
            this.platform.setPlatformCoordinator(this.zpAccessory)
            if (this.zpAccessory.coordinator !== this.zpAccessory) {
              this.zpAccessory.coordinator.zpClient.delegateGroupCoordinationTo(
                this.zpClient.id
              )
            }
          } else {
            setTimeout(() => {
              this.values.sonosCoordinator = true
            }, this.platform.config.resetTimeout)
          }
        } catch (error) {
          this.error(error)
        }
      }
    })
    this.addCharacteristicDelegate({
      key: 'platformCoordinatorId',
      silent: true
    })
    if (this.values.sonosCoordinator) {
      this.platform.setPlatformCoordinator(this.zpAccessory)
    }
    this.addCharacteristicDelegate({
      key: 'logLevel',
      Characteristic: this.Characteristics.my.LogLevel,
      props: { maxValue: 4 },
      value: this.accessoryDelegate.logLevel
    })
    this.addCharacteristicDelegate({
      key: 'lastSeen',
      Characteristic: this.Characteristics.my.LastSeen,
      value: 'n/a',
      silent: true
    })
    this.addCharacteristicDelegate({
      key: 'statusFault',
      Characteristic: this.Characteristics.hap.StatusFault,
      value: this.Characteristics.hap.StatusFault.GENERAL_FAULT
    })

    this.values.statusFault = this.Characteristics.hap.StatusFault.GENERAL_FAULT
    this.emit('initialised')

    zpAccessory.once('initialised', async () => {
      try {
        await this.zpClient.subscribe('/MediaRenderer/AVTransport/Event')
        await this.zpClient.subscribe('/MediaRenderer/GroupRenderingControl/Event')
      } catch (error) {
        this.error(error)
      }
    })
  }

  handleMediaRendererAVTransportEvent (message) {
    if (
      message.lastChange == null ||
      !Array.isArray(message.lastChange) ||
      message.lastChange[0] == null
    ) {
      return
    }
    if (this.zpAccessory.isCoordinator === false) {
      this.zpAccessory.leaving = true
    }
    const event = message.lastChange[0]
    let on
    let tv = false
    let track
    let currentTransportActions
    let repeat
    let shuffle
    let crossfade
    let currentValidPlayModes
    let uri
    const state = event.transportState
    if (state != null) {
      on = state === 'PLAYING' || state === 'TRANSITIONING'
    }
    const meta = event.currentTrackMetaData
    // this.debug('currentTrackMetaData: %j', meta)
    if (event.currentTrackUri != null && event.currentTrackUri !== '') {
      switch (event.currentTrackUri.split(':')[0]) {
        case 'x-rincon-buzzer': // Sonos Chime
          track = 'Sonos Chime'
          uri = event.currentTrackUri
          break
        case 'x-sonos-vli': // AirPlay
        case 'x-sonosapi-vli': // Airplay ???
          track = meta.title
          uri = event.currentTrackUri.split(',')[0]
          break
        case 'x-rincon-stream': // Line in input.
          track = meta.title
          uri = event.currentTrackUri
          break
        case 'x-sonos-htastream': // SPDIF TV input.
          track = 'TV'
          tv = meta.streamInfo !== 0 // 0: no input; 2: stereo; 18: Dolby 5.1; 22: ?
          uri = event.currentTrackUri
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
        case 'hls-radio': { // Radio stream, see #125.
          const a = /^TYPE=SNG\|TITLE (.*)\|ARTIST (.*)\|ALBUM/.exec(meta.streamContent)
          if (a != null) {
            track = a[2] === '' ? a[1] : a[2] + ' - ' + a[1]
          } else if (event.enqueuedTransportUriMetaData != null) {
            track = event.enqueuedTransportUriMetaData.title // station
          }
        }
          break
        case 'x-file-cifs': // Library song.
        case 'x-sonos-http': // See issue #44.
        case 'http': // Song on iDevice.
        case 'https': // Apple Music, see issue #68
        case 'x-sonos-spotify': // Spotify song.
        case 'x-sonosprog-http': // Apple Music, see issue #125
        case 'x-sonosapi-rtrecent': // ??
          if (meta.title != null) {
            track = meta.title // song
          }
          break
        case 'x-sonosapi-hls': // ??
        case 'x-sonosapi-hls-static': // e.g. Amazon Music
          // Skip! update will arrive in subsequent CurrentTrackMetaData events
          // and will be handled by default case
          break
        case 'x-rincon': // zone group
          // skip - handled by coordinator
          break
        default:
          this.warn('unknown uri: %j', event.currentTrackUri)
          if (meta.title != null) {
            track = meta.title // song
          } else {
            track = ''
          }
          break
      }
    }
    if (
      event.enqueuedTransportUri != null && event.enqueuedTransportUri !== ''
    ) {
      uri = event.enqueuedTransportUri // playlist
    }
    if (event.currentTransportActions != null) {
      currentTransportActions = event.currentTransportActions.split(', ')
      if (currentTransportActions.length === 1) {
        track = ''
      }
    }
    if (
      event.sleepTimerGeneration != null &&
      this.zpAccessory.coordinator === this.zpAccessory
    ) {
      this.zpClient.getSleepTimer().then((timer) => {
        const value = timer === ''
          ? 0
          : timer.split(':').reduce((value, time) => {
            return 60 * value + +time
          })
        this.values.remainingDuration = value
        for (const member of this.zpAccessory.members()) {
          member.sonosService.values.remainingDuration =
            this.values.remainingDuration
        }
      }).catch((error) => { this.error(error) })
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
      this.values.currentTrack = track.slice(0, 64)
      for (const member of this.zpAccessory.members()) {
        member.sonosService.values.currentTrack = this.values.currentTrack
      }
    }
    if (event.currentValidPlayModes != null) {
      currentValidPlayModes = event.currentValidPlayModes.split(',')
    }
    if (event.currentPlayMode != null) {
      if (event.currentPlayMode === 'NORMAL') {
        repeat = 0
        shuffle = false
      } else if (event.currentPlayMode === 'REPEAT_ONE') {
        repeat = 1
        shuffle = false
      } else if (event.currentPlayMode === 'REPEAT_ALL') {
        repeat = 2
        shuffle = false
      } else if (event.currentPlayMode === 'SHUFFLE_NOREPEAT') {
        repeat = 0
        shuffle = true
      } else if (event.currentPlayMode === 'SHUFFLE_REPEAT_ONE') {
        repeat = 1
        shuffle = true
      } else if (event.currentPlayMode === 'SHUFFLE') {
        repeat = 2
        shuffle = true
      }
    }
    if (event.currentCrossfadeMode != null) {
      crossfade = event.currentCrossfadeMode === 1
    }
    if (tv != null) {
      if (tv !== this.values.tv) {
        if (tv || this.values.tv == null || track !== 'TV') {
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
    if (currentValidPlayModes != null) {
      this.values.currentValidPlayModes = currentValidPlayModes
      for (const member of this.zpAccessory.members()) {
        member.sonosService.values.currentValidPlayModes =
          this.values.currentValidPlayModes
      }
    }
    if (repeat != null) {
      this.values.repeat = repeat
      this.values.shuffle = shuffle
      for (const member of this.zpAccessory.members()) {
        member.sonosService.values.repeat = this.values.repeat
        member.sonosService.values.shuffle = this.values.shuffle
      }
    }
    if (crossfade != null) {
      this.values.crossfade = crossfade
      for (const member of this.zpAccessory.members()) {
        member.sonosService.values.crossfade = this.values.crossfade
      }
    }
    if (uri != null) {
      this.values.uri = he.escape(uri)
      for (const member of this.zpAccessory.members()) {
        member.sonosService.values.uri = this.values.uri
      }
    }
  }

  handleMediaRendererGroupRenderingControlEvent (message) {
    if (message.groupVolume != null) {
      this.values.volume = message.groupVolume
      for (const member of this.zpAccessory.members()) {
        member.sonosService.values.volume = this.values.volume
      }
    }
    if (message.groupMute != null) {
      this.values.mute = !!message.groupMute
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
    this.debug('Speaker service')
    this.zpClient.on('message', (message) => {
      try {
        const f = `handle${message.device}${message.service}Event`
        if (this[f] != null) {
          this[f](message.parsedBody)
        }
      } catch (error) {
        this.error(error)
      }
    })
    this.addCharacteristicDelegate({
      key: 'on',
      Characteristic: this.Characteristics.hap.On,
      setter: async (value) => {
        try {
          if (value === this.values.on) {
            return
          }
          const platformCoordinator = this.platform.coordinators[this.zpClient.household]
          if (platformCoordinator === this.zpAccessory) {
            setTimeout(() => {
              this.values.on = false
            }, this.platform.config.resetTimeout)
            return
          }
          if (value) {
            const coordinator = platformCoordinator
            if (coordinator != null) {
              return this.zpClient.setAvTransportGroup(coordinator.zpClient.id)
            } else {
              // No coordinator yet.
              setTimeout(() => {
                this.values.on = false
              }, this.platform.config.resetTimeout)
            }
          } else {
            return this.zpClient.becomeCoordinatorOfStandaloneGroup()
          }
        } catch (error) {
          this.error(error)
        }
      },
      timeout: 5000
    })
    this.addCharacteristicDelegate({
      key: 'volume',
      Characteristic: this.platform.config.VolumeCharacteristic,
      unit: '%',
      setter: this.zpClient.setVolume.bind(this.zpClient)
    })
    this.addCharacteristicDelegate({
      key: 'changeVolume',
      Characteristic: this.Characteristics.my.ChangeVolume,
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
    this.addCharacteristicDelegate({
      key: 'mute',
      Characteristic: this.Characteristics.hap.Mute,
      setter: this.zpClient.setMute.bind(this.zpClient)
    })
    this.addCharacteristicDelegate({
      key: 'loudness',
      Characteristic: this.Characteristics.my.Loudness,
      setter: this.zpClient.setLoudness.bind(this.zpClient)
    })
    this.addCharacteristicDelegate({
      key: 'bass',
      Characteristic: this.Characteristics.my.Bass,
      setter: this.zpClient.setBass.bind(this.zpClient)
    })
    this.addCharacteristicDelegate({
      key: 'treble',
      Characteristic: this.Characteristics.my.Treble,
      setter: this.zpClient.setTreble.bind(this.zpClient)
    })
    if (this.zpClient.balance) {
      this.addCharacteristicDelegate({
        key: 'balance',
        Characteristic: this.Characteristics.my.Balance,
        unit: '%',
        setter: this.zpClient.setBalance.bind(this.zpClient)
      })
    }
    if (this.zpClient.tvIn) {
      this.addCharacteristicDelegate({
        key: 'nightSound',
        Characteristic: this.Characteristics.my.NightSound,
        setter: this.zpClient.setNightSound.bind(this.zpClient)
      })
      this.addCharacteristicDelegate({
        key: 'speechEnhancement',
        Characteristic: this.Characteristics.my.SpeechEnhancement,
        setter: this.zpClient.setSpeechEnhancement.bind(this.zpClient)
      })
    }
    if (/\(.*\+Sub.*\)/.test(this.zpClient.zoneDisplayName)) {
      this.addCharacteristicDelegate({
        key: 'subEnabled',
        Characteristic: this.Characteristics.my.SubEnabled,
        setter: this.zpClient.setSubEnable.bind(this.zpClient)
      })
      this.addCharacteristicDelegate({
        key: 'subLevel',
        Characteristic: this.Characteristics.my.SubLevel,
        setter: this.zpClient.setSubLevel.bind(this.zpClient)
      })
    }

    this.emit('initialised')

    zpAccessory.once('initialised', async () => {
      try {
        await this.zpClient.subscribe('/MediaRenderer/RenderingControl/Event')
      } catch (error) {
        this.error(error)
      }
    })
  }

  handleMediaRendererRenderingControlEvent (message) {
    if (
      message.lastChange == null ||
      !Array.isArray(message.lastChange) ||
      message.lastChange[0] == null
    ) {
      return
    }
    const event = message.lastChange[0]
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
    if (event.subEnabled != null) {
      this.values.subEnabled = !!event.subEnabled
    }
    if (event.subGain != null) {
      this.values.subLevel = event.subGain
    }
  }
}

class Led extends ZpService {
  constructor (zpAccessory, zpClient) {
    const params = {
      name: zpClient.zoneName + ' Sonos LED',
      Service: zpAccessory.Services.hap.Lightbulb,
      subtype: 'led' + (zpClient.channel == null ? '' : zpClient.channel)
    }
    if (zpClient.role !== 'master' && zpClient.channel != null) {
      params.name = zpClient.zoneName + ' Sonos ' + zpClient.channel + ' LED'
    }
    super(zpAccessory, params)
    this.debug('LED service')
    const paramsOn = {
      key: 'on',
      Characteristic: this.Characteristics.hap.On,
      setter: this.zpClient.setLedState.bind(this.zpClient)
    }
    const paramsLocked = {
      key: 'locked',
      Characteristic: this.Characteristics.hap.LockPhysicalControls,
      props: { adminOnlyAccess: [this.Characteristic.Access.WRITE] },
      setter: this.zpClient.setButtonLockState.bind(this.zpClient)
    }
    if (!(this.platform.config.heartrate > 0)) {
      paramsOn.getter = this.zpClient.getLedState.bind(this.zpClient)
      paramsLocked.getter = async (value) => {
        return (await this.zpClient.getButtonLockState())
          ? this.Characteristics.hap.LockPhysicalControls.CONTROL_LOCK_ENABLED
          : this.Characteristics.hap.LockPhysicalControls.CONTROL_LOCK_DISABLED
      }
    }
    this.addCharacteristicDelegate(paramsOn)
    this.addCharacteristicDelegate(paramsLocked)
    if (zpClient.role !== 'master') {
      this.addCharacteristicDelegate({
        key: 'lastSeen',
        Characteristic: this.Characteristics.my.LastSeen,
        value: 'n/a',
        silent: true
      })
      this.addCharacteristicDelegate({
        key: 'statusFault',
        Charactertistic: this.Characteristics.hap.StatusFault,
        value: this.Characteristics.hap.StatusFault.GENERAL_FAULT
      })
      this.values.statusFault =
        this.Characteristics.hap.StatusFault.GENERAL_FAULT
    }

    if (this.platform.config.heartrate > 0) {
      this.zpAccessory.on('heartbeat', async (beat) => {
        try {
          if (beat % this.platform.config.heartrate === 0) {
            if (!this.zpAccessory.blinking) {
              this.values.on = await this.zpClient.getLedState()
            }
            this.values.locked = (await this.zpClient.getButtonLockState())
              ? this.Characteristics.hap.LockPhysicalControls.CONTROL_LOCK_ENABLED
              : this.Characteristics.hap.LockPhysicalControls.CONTROL_LOCK_DISABLED
          }
        } catch (error) {
          this.error(error)
        }
      })
    }
    this.emit('initialised')
  }
}

class Alarm extends ZpService {
  constructor (zpAccessory, alarm) {
    const params = {
      id: alarm.id,
      name: zpAccessory.zpClient.zoneName + ' Sonos Alarm ' + alarm.id,
      Service: zpAccessory.Services.hap.Switch,
      subtype: 'alarm' + alarm.id
    }
    super(zpAccessory, params)
    this.debug('Alarm service')
    this.addCharacteristicDelegate({
      key: 'on',
      Characteristic: this.Characteristics.hap.On,
      setter: async (value) => {
        const alarm = Object.assign({}, this._alarm)
        alarm.enabled = value ? 1 : 0
        return this.zpClient.updateAlarm(alarm)
      }
    })
    this.addCharacteristicDelegate({
      key: 'currentTrack',
      Characteristic: this.Characteristics.my.CurrentTrack
    })
    this.addCharacteristicDelegate({
      key: 'time',
      Characteristic: this.Characteristics.my.Time
    })
    this.emit('initialised')
    this._alarm = alarm
  }

  get alarm () { return this._alarm }

  set alarm (alarm) {
    this._alarm = alarm
    this.values.on = alarm.enabled === 1
    this.values.currentTrack = alarm.programUri === 'x-rincon-buzzer:0'
      ? 'Sonos Chime'
      : alarm.programMetaData != null && alarm.programMetaData.title != null
        ? alarm.programMetaData.title.slice(0, 64)
        : 'unknown'
    this.values.time = alarm.startTime
  }
}

const remoteKeys = {}
const volumeSelectors = {}

function initRemoteKeys (characteristicHap) {
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
    params.name = params.master.sonosService.values.configuredName
    params.Service = zpAccessory.Services.hap.Television
    params.subtype = 'tv'
    params.primaryService = true
    super(zpAccessory, params)
    this.debug('TV service')
    initRemoteKeys(this.Characteristics.hap)

    this.zpMaster = params.master
    this.sonosService = this.zpMaster.sonosService
    this.sonosValues = this.sonosService.values
    this.sonosService.characteristicDelegate('configuredName')
      .on('didSet', (value) => {
        this.values.configuredName = value
      })
    this.characteristicDelegate('configuredName')
      .on('didSet', (value) => {
        this.sonosService.values.configuredName = value
      })

    this.speaker = new ZpService.Tv.Speaker(this.zpAccessory, {
      master: params.master
    })

    // HomeKit doesn't like changes to service or characteristic properties,
    // so we create a static set of (disabled, hidden) InputSource services
    // to be configured later.
    this.sources = []
    this.inputSources = []
    this.displayOrder = []
    for (
      let identifier = 1;
      identifier <= this.platform.config.maxFavourites;
      identifier++
    ) {
      const inputSource = new ZpService.Tv.InputSource(this.zpAccessory, {
        configuredName: 'Input ' + identifier,
        identifier,
        tvService: this
      })
      this.inputSources.push(inputSource)
      this.displayOrder.push(0x01, 0x04, identifier & 0xff, 0x00, 0x00, 0x00)
    }
    this.displayOrder.push(0x00, 0x00)
    this.once('initialised', () => {
      this.sonosService.characteristicDelegate('platformCoordinatorId')
        .on('didSet', (value) => {
          this.updateGroupInputSource()
        })
    })

    this.addCharacteristicDelegate({
      key: 'active',
      Characteristic: this.Characteristics.hap.Active,
      value: this.sonosValues.on
        ? this.Characteristics.hap.Active.ACTIVE
        : this.Characteristics.hap.Active.INACTIVE
    }).on('didSet', (value) => {
      this.sonosService.characteristicDelegate('on').setValue(value)
    })
    this.sonosService.characteristicDelegate('on').on('didSet', (value) => {
      this.values.active = value ? 1 : 0
    })
    const activeIdentifier = this.addCharacteristicDelegate({
      key: 'activeIdentifier',
      Characteristic: this.Characteristics.hap.ActiveIdentifier,
      props: { maxValue: this.platform.config.maxFavourites },
      silent: true,
      setter: async (value) => {
        try {
          if (value < 1 || value > this.platform.config.maxFavourites) {
            return
          }
          const source = this.sources[value - 1]
          this.log(
            'set %s to %j', activeIdentifier.displayName, source.configuredName
          )
          if (value === 1 && source.uri == null) {
            await this.zpClient.becomeCoordinatorOfStandaloneGroup()
          } else if (source.uri != null) {
            const zp = value <= 4 ? this.zpMaster : this.zpMaster.coordinator
            if (source.container) {
              await zp.zpClient.setAvTransportQueue(
                source.uri, source.meta
              )
            } else {
              await zp.zpClient.setAvTransportUri(
                source.uri, source.meta
              )
            }
            zp.zpClient.play().catch((error) => { this.error(error) })
            if (value === 1) {
              // Joined a group
              setTimeout(() => {
                this.values.activeIdentifier =
                  zp.sonosService.values.activeIdentifier
              }, this.platform.config.resetTimeout)
            }
          }
        } catch (error) {
          this.error(error)
        }
        this.ignoreDidSet = true
      }
    }).on('didSet', (value) => {
      this.sonosValues.activeIdentifier = value
      if (this.ignoreDidSet) {
        delete this.ignoreDidSet
        return
      }
      if (value > 0) {
        const source = this.sources[value - 1]
        this.log('set %s to %j', activeIdentifier.displayName, source.configuredName)
      }
    })
    this.sonosService.characteristicDelegate('changeInput')
      .on('didSet', (value) => {
        if (value !== 0) {
          activeIdentifier.setValue(this.nextIdentifier(value))
        }
      })
    this.sonosService.characteristicDelegate('uri')
      .on('didSet', (value) => {
        const identifier = this.activeIdentifier(this.sonosValues.uri)
        this.values.activeIdentifier = identifier
      })
    this.addCharacteristicDelegate({
      key: 'sleepDiscoveryMode',
      Characteristic: this.Characteristics.hap.SleepDiscoveryMode,
      silent: true,
      value: this.Characteristics.hap.SleepDiscoveryMode.ALWAYS_DISCOVERABLE
    })
    this.addCharacteristicDelegate({
      key: 'displayOrder',
      Characteristic: this.Characteristics.hap.DisplayOrder,
      silent: true,
      value: Buffer.from(this.displayOrder).toString('base64')
    })
    const remoteKey = this.addCharacteristicDelegate({
      key: 'remoteKey',
      Characteristic: this.Characteristics.hap.RemoteKey,
      silent: true
    }).on('didSet', (value) => {
      this.log('%s: %s', remoteKey.displayName, remoteKeys[value])
      switch (value) {
        case this.Characteristics.hap.RemoteKey.PLAY_PAUSE:
          {
            const value = 1 - this.values.active
            this.sonosService.characteristicDelegate('on').setValue(value)
          }
          break
        case this.Characteristics.hap.RemoteKey.ARROW_LEFT:
          this.sonosService.characteristicDelegate('changeTrack').setValue(-1)
          break
        case this.Characteristics.hap.RemoteKey.ARROW_RIGHT:
          this.sonosService.characteristicDelegate('changeTrack').setValue(1)
          break
        case this.Characteristics.hap.RemoteKey.ARROW_UP:
          activeIdentifier.setValue(this.nextIdentifier(-1))
          break
        case this.Characteristics.hap.RemoteKey.ARROW_DOWN:
          activeIdentifier.setValue(this.nextIdentifier(1))
          break
        default:
          break
      }
    })
    this.addCharacteristicDelegate({
      key: 'powerModeSelection',
      Characteristic: this.Characteristics.hap.PowerModeSelection
    }).on('didSet', (value) => {
      this.sonosService.characteristicDelegate('sonosCoordinator')
        .setValue(true)
    })
    this.addCharacteristicDelegate({
      key: 'statusFault',
      Characteristic: this.Characteristics.hap.StatusFault,
      value: this.Characteristics.hap.StatusFault.GENERAL_FAULT
    })

    this.values.statusFault = this.Characteristics.hap.StatusFault.GENERAL_FAULT

    this.notYetInitialised = true
    this.favouritesUpdated()
    this.zpHousehold.on('favouritesUpdated', this.favouritesUpdated.bind(this))
  }

  activeIdentifier (uri) {
    for (let i = 0; i < this.sources.length; i++) {
      if (this.sources[i].uri === uri) {
        return i + 1
      }
    }
    return 0
  }

  nextIdentifier (value) {
    let identifier = this.values.activeIdentifier
    const oldIdentifier = identifier
    do {
      identifier += value
      if (identifier < 2) {
        identifier = this.platform.config.maxFavourites - 1
      }
      if (identifier > this.platform.config.maxFavourites - 1) {
        identifier = 2
      }
    } while (
      this.inputSources[identifier - 1].values.currentVisibilityState !==
      this.Characteristics.hap.CurrentVisibilityState.SHOWN &&
      identifier !== oldIdentifier
    )
    return identifier
  }

  favouritesUpdated () {
    const favs = this.zpHousehold.favourites
    if (favs == null) {
      return
    }
    this.sources = []
    this.configureInputSource('n/a', null, false)
    this.updateGroupInputSource(true)
    this.configureInputSource(
      'AirPlay', 'x-sonos-vli:' + this.zpClient.id + ':1', false
    )
    this.configureInputSource(
      'Audio In', 'x-rincon-stream:' + this.zpClient.id, this.zpClient.audioIn
    )
    this.configureInputSource(
      'TV', 'x-sonos-htastream:' + this.zpClient.id + ':spdif',
      this.zpClient.tvIn
    )
    for (const key in favs) {
      const fav = favs[key]
      this.configureInputSource(
        key.slice(0, 64), fav.uri, true, fav.container, fav.meta
      )
    }
    for (
      let index = this.sources.length;
      index < this.platform.config.maxFavourites - 1;
      index++
    ) {
      this.configureInputSource(`Input ${index + 1}`, null, false)
    }
    this.configureInputSource('Sonos Chime', 'x-rincon-buzzer:0', true)
    this.log(
      'input sources: %j',
      this.sources.filter((source) => {
        return source.visible
      }).map((source) => {
        return source.configuredName
      })
    )
    if (this.notYetInitialised) {
      delete this.notYetInitialised
      this.emit('initialised')
    }
    this.values.activeIdentifier = this.activeIdentifier(this.sonosValues.uri)
  }

  updateGroupInputSource (silent = false) {
    const index = 0
    const source = this.sources[index]
    const inputSource = this.inputSources[index]
    if (source == null || inputSource == null) {
      return
    }

    const platformCoordinatorId = this.sonosValues.platformCoordinatorId
    let configuredName = 'n/a'
    let uri
    let visible = false
    if (
      this.sonosValues.sonosGroup != null &&
      this.sonosValues.sonosGroup !== this.zpClient.zoneName
    ) {
      configuredName = 'Leave ' + this.sonosValues.sonosGroup
      visible = true
    } else if (
      platformCoordinatorId != null &&
      platformCoordinatorId !== this.zpClient.id
    ) {
      const zpClient = this.platform.zpClients[platformCoordinatorId]
      configuredName = 'Join ' + zpClient.zoneGroupShortName
      uri = 'x-rincon:' + platformCoordinatorId
      visible = true
    }
    source.configuredName = configuredName
    source.uri = uri
    source.visible = visible
    inputSource.values.configuredName = configuredName
    inputSource.values.isConfigured = visible
      ? this.Characteristics.hap.IsConfigured.CONFIGURED
      : this.Characteristics.hap.IsConfigured.NOT_CONFIGURED
    inputSource.values.targetVisibilityState = visible
      ? this.Characteristics.hap.TargetVisibilityState.SHOWN
      : this.Characteristics.hap.TargetVisibilityState.HIDDEN
    if (!silent) {
      this.log(
        'Input Sources: %j',
        this.sources.filter((source) => {
          return source.visible
        }).map((source) => {
          return source.configuredName
        })
      )
    }
  }

  configureInputSource (configuredName, uri, visible, container, meta) {
    this.sources.push({ configuredName, uri, visible, container, meta })
    const identifier = this.sources.length
    if (identifier <= this.platform.config.maxFavourites) {
      const inputSource = this.inputSources[identifier - 1]
      inputSource.values.configuredName = configuredName
      inputSource.values.isConfigured = visible
        ? this.Characteristics.hap.IsConfigured.CONFIGURED
        : this.Characteristics.hap.IsConfigured.NOT_CONFIGURED
      if (configuredName === 'Sonos Chime') {
        visible = false
      }
      inputSource.values.targetVisibilityState = visible
        ? this.Characteristics.hap.TargetVisibilityState.SHOWN
        : this.Characteristics.hap.TargetVisibilityState.HIDDEN
      if (configuredName === 'AirPlay') {
        inputSource.values.inputSourceType =
          this.Characteristics.hap.InputSourceType.OTHER
      } else if (configuredName === 'TV') {
        inputSource.values.inputSourceType =
          this.Characteristics.hap.InputSourceType.HDMI
      } else if (uri != null && uri.startsWith('x-sonosapi-stream:')) {
        inputSource.values.inputSourceType =
          this.Characteristics.hap.InputSourceType.TUNER
      }
    }
  }

  static get Speaker () { return TvSpeaker }

  static get InputSource () { return TvInputSource }
}

class TvSpeaker extends ZpService {
  constructor (zpAccessory, params = {}) {
    params.name = zpAccessory.zpClient.zoneName + ' TV Speaker'
    params.Service = zpAccessory.Services.hap.TelevisionSpeaker
    params.subtype = 'tvSpeaker'
    super(zpAccessory, params)
    const service = params.master.speakerService == null
      ? params.master.sonosService
      : params.master.speakerService
    this.addCharacteristicDelegate({
      key: 'volumeControlType',
      Characteristic: this.Characteristics.hap.VolumeControlType,
      silent: true,
      value: this.Characteristics.hap.VolumeControlType.ABSOLUTE
    })
    const volumeSelector = this.addCharacteristicDelegate({
      key: 'volumeSelector',
      Characteristic: this.Characteristics.hap.VolumeSelector,
      silent: true
    }).on('didSet', (value) => {
      this.log('%s: %s', volumeSelector.displayName, volumeSelectors[value])
      service.characteristicDelegate('changeVolume').setValue(
        value === this.Characteristics.hap.VolumeSelector.INCREMENT ? 1 : -1
      )
    })
    this.addCharacteristicDelegate({
      key: 'mute',
      Characteristic: this.Characteristics.hap.Mute
    }).on('didSet', (value) => {
      service.characteristicDelegate('mute').setValue(value)
    })
    this.emit('initialised')
  }
}

class TvInputSource extends ZpService {
  constructor (zpAccessory, params = {}) {
    params.name = zpAccessory.zpClient.zoneName + ' TV Input ' +
      params.identifier
    params.Service = zpAccessory.Services.hap.InputSource
    params.subtype = 'tvInput' + params.identifier
    params.linkedServiceDelegate = params.tvService
    super(zpAccessory, params)
    this.tvService = params.tvService
    this.values.configuredName = params.configuredName
    this.addCharacteristicDelegate({
      key: 'identifier',
      Characteristic: this.Characteristics.hap.Identifier,
      silent: true,
      value: params.identifier
    })
    this.addCharacteristicDelegate({
      key: 'inputSourceType',
      Characteristic: this.Characteristics.hap.InputSourceType,
      silent: true,
      value: this.Characteristics.hap.InputSourceType.OTHER
    })
    this.addCharacteristicDelegate({
      key: 'inputDeviceType',
      Characteristic: this.Characteristics.hap.InputDeviceType,
      silent: true,
      value: this.Characteristics.hap.InputDeviceType.AUDIO_SYSTEM
    })
    this.addCharacteristicDelegate({
      key: 'isConfigured',
      Characteristic: this.Characteristics.hap.IsConfigured,
      silent: true,
      value: this.Characteristics.hap.IsConfigured.NOT_CONFIGURED
    })
    this.addCharacteristicDelegate({
      key: 'currentVisibilityState',
      Characteristic: this.Characteristics.hap.CurrentVisibilityState,
      silent: true,
      value: this.Characteristics.hap.CurrentVisibilityState.HIDDEN
    })
    this.addCharacteristicDelegate({
      key: 'targetVisibilityState',
      Characteristic: this.Characteristics.hap.TargetVisibilityState,
      silent: true,
      value: this.Characteristics.hap.TargetVisibilityState.HIDDEN
    }).on('didSet', (value) => {
      this.values.currentVisibilityState =
        value === this.Characteristics.hap.TargetVisibilityState.SHOWN
          ? this.Characteristics.hap.CurrentVisibilityState.SHOWN
          : this.Characteristics.hap.CurrentVisibilityState.HIDDEN
    })
    this.emit('initialised')
  }
}

module.exports = ZpService
