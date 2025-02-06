// homebridge-zp/lib/ZpService/Tv.js
// Copyright © 2016-2025 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

import { ZpService } from './index.js'

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
  static get Speaker () { return TvSpeaker }
  static get InputSource () { return TvInputSource }

  constructor (zpAccessory, params = {}) {
    params.name = zpAccessory.sonosService.values.configuredName
    params.Service = zpAccessory.Services.hap.Television
    params.subtype = 'tv'
    params.primaryService = true
    super(zpAccessory, params)
    this.debug('TV service')
    initRemoteKeys(this.Characteristics.hap)

    this.zpMaster = params.master
    this.sonosService = zpAccessory.sonosService
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
    this.configureInputSource('none', null, false)
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
    const zpClient = this.platform.zpClients[platformCoordinatorId]
    let configuredName = 'none'
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
      platformCoordinatorId !== this.zpClient.id &&
      zpClient != null
    ) {
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
}

class TvSpeaker extends ZpService {
  constructor (zpAccessory, params = {}) {
    params.name = zpAccessory.zpClient.zoneName + ' TV Speaker'
    params.Service = zpAccessory.Services.hap.TelevisionSpeaker
    params.subtype = 'tvSpeaker'
    super(zpAccessory, params)
    const service = zpAccessory.speakerService ?? zpAccessory.sonosService
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
    params.name = params.configuredName
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

ZpService.Tv = Tv
