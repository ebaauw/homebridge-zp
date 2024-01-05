#!/usr/bin/env node

// homebridge-zp/cli/zp.js
// Copyright © 2019-2024 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

const homebridgeLib = require('homebridge-lib')
const ZpClient = require('../lib/ZpClient')
const ZpListener = require('../lib/ZpListener')
const packageJson = require('../package.json')

const { b, u } = homebridgeLib.CommandLineTool
const { UsageError } = homebridgeLib.CommandLineParser

const usage = {
  zp: `${b('zp')} [${b('-hVD')}] [${b('-H')} ${u('hostname')}[${b(':')}${u('port')}]] [${b('-t')} ${u('timeout')}] ${u('command')} [${u('argument')} ...]`,
  info: `${b('info')} [${b('-hnv')}]`,
  description: `${b('description')} [${b('-hnSs')}]`,
  topology: `${b('topology')} [${b('-hn')}] [${b('-pv')}|${b('-r')}]`,
  eventlog: `${b('eventlog')} [${b('-hnst')}]`,
  browse: `${b('browse')} [${b('-hn')}] [${u('object')}]`,
  play: `${b('play')} [${b('-h')}] [${u('uri')} [${u('meta')}]]`,
  queue: `${b('queue')} [${b('-h')}] ${u('uri')} [${u('meta')}]`,
  pause: `${b('pause')} [${b('-h')}]`,
  stop: `${b('stop')} [${b('-h')}]`,
  next: `${b('next')} [${b('-h')}]`,
  previous: `${b('previous')} [${b('-h')}]`,
  crossfade: `${b('crossfade')} [${b('-h')}] [${b('on')}|${b('off')}]`,
  repeat: `${b('repeat')} [${b('-h')}] [${b('on')}|${b('1')}|${b('off')}]`,
  shuffle: `${b('shuffle')} [${b('-h')}] [${b('on')}|${b('off')}]`,
  sleepTimer: `${b('sleepTimer')} [${b('-h')}] [${u('time')}|${b('off')}]`,
  groupVolume: `${b('groupVolume')} [${b('-h')}] [${u('volume')}]`,
  groupMute: `${b('groupMute')} [${b('-h')}] [${b('on')}|${b('off')}]`,
  join: `${b('join')} [${b('-h')}] ${u('zone')}`,
  leave: `${b('leave')} [${b('-h')}]`,
  volume: `${b('volume')} [${b('-h')}] [${u('volume')}]`,
  mute: `${b('mute')} [${b('-h')}] [${b('on')}|${b('off')}]`,
  bass: `${b('bass')} [${b('-h')}] [${b('--')}] [${u('bass')}]`,
  treble: `${b('treble')} [${b('-h')}] [${b('--')}] [${u('treble')}]`,
  loudness: `${b('loudness')} [${b('-h')}] [${b('on')}|${b('off')}]`,
  balance: `${b('balance')} [${b('-h')}] [${b('--')}] [${u('balance')}]`,
  nightSound: `${b('nightSound')} [${b('-h')}] [${b('on')}|${b('off')}]`,
  speechEnhancement: `${b('speechEnhancement')} [${b('-h')}] [${b('on')}|${b('off')}]`,
  surroundEnable: `${b('surroundEnable')} [${b('-h')}] [${b('on')}|${b('off')}]`,
  tvLevel: `${b('tvLevel')} [${b('-h')}] [${b('--')}] [${u('level')}]`,
  musicLevel: `${b('musicLevel')} [${b('-h')}] [${b('--')}] [${u('level')}]`,
  musicPlaybackFull: `${b('musicPlaybackFull')} [${b('-h')}] [${b('on')}|${b('off')}]`,
  heightLevel: `${b('heightLevel')} [${b('-h')}] [${b('--')}] [${u('level')}]`,
  subEnable: `${b('subEnable')} [${b('-h')}] [${b('on')}|${b('off')}]`,
  subLevel: `${b('subLevel')} [${b('-h')}] [${b('--')}] [${u('level')}]`,
  led: `${b('led')} [${b('-h')}] [${b('on')}|${b('off')}]`,
  buttonLock: `${b('buttonLock')} [${b('-h')}] [${b('on')}|${b('off')}]`
}

const description = {
  zp: 'Command line interface to Sonos ZonePlayer.',
  info: 'Print zone player properties.',
  description: 'Print zone player device description.',
  topology: 'Print zones and zone players known by the zone player.',
  eventlog: 'Log zone player events.',
  browse: 'Browse media.',
  play: 'Play.',
  queue: 'Queue.',
  pause: 'Pause.',
  stop: 'Stop.',
  next: 'Go to next track.',
  previous: 'Go to previous track.',
  crossfade: 'Get/set/clear crossfade.',
  repeat: 'Get/set repeat.',
  shuffle: 'Get/set/clear shuffle.',
  sleepTimer: 'Get/set/clear sleep timer.',
  groupVolume: 'Get/set group volume.',
  groupMute: 'Get/set/clear group mute.',
  join: 'Join ZoneGroup.',
  leave: 'Leave ZoneGroup.',
  volume: 'Get/set volume.',
  mute: 'Get/set/clear mute.',
  bass: 'Get/set bass.',
  treble: 'Get/set treble.',
  loudness: 'Get/set/clear loudness.',
  balance: 'Get/set balance.',
  nightSound: 'Get/set/clear nightsound.',
  speechEnhancement: 'Get/set/clear speech enhancement.',
  surroundEnable: 'Get/set/clear surround enabled state.',
  tvLevel: 'Get/set TV surround level.',
  musicLevel: 'Get/set music surround level.',
  musicPlaybackFull: 'Get/set/clear full music playback.',
  heightLevel: 'Get/set height channel level.',
  subEnable: 'Get/set/clear Sub enabled state.',
  subLevel: 'Get/set Sub level.',
  led: 'Get/set/clear LED state.',
  buttonLock: 'Get/set/clear button lock state.'
}

const help = {
  zp: `${description.zp}

Usage: ${usage.zp}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('-V')}, ${b('--version')}
  Print version and exit.

  ${b('-D')}, ${b('--debug')}
  Print debug messages.

  ${b('-H')} ${u('hostname')}[${b(':')}${u('port')}], ${b('--host=')}${u('hostname')}[${b(':')}${u('port')}]
  Connect to ZonePlayer at ${u('hostname')}${b(':1400')} or ${u('hostname')}${b(':')}${u('port')}.
  Default ZonePlayer can be set in the ${b('ZP_HOST')} environment variable.

  ${b('-t')} ${u('timeout')}, ${b('--timeout=')}${u('timeout')}
  Set timeout to ${u('timeout')} seconds instead of default ${b('5')}.

Commands:
  ${usage.info}
  ${description.info}

  ${usage.description}
  ${description.description}

  ${usage.topology}
  ${description.topology}

  ${usage.eventlog}
  ${description.eventlog}

  ${usage.browse}
  ${description.browse}

  ${usage.play}
  ${description.play}

  ${usage.queue}
  ${description.queue}

  ${usage.pause}
  ${description.pause}

  ${usage.stop}
  ${description.stop}

  ${usage.next}
  ${description.next}

  ${usage.previous}
  ${description.previous}

  ${usage.sleepTimer}
  ${description.sleepTimer}

  ${usage.groupVolume}
  ${description.groupVolume}

  ${usage.groupMute}
  ${description.groupMute}

  ${usage.join}
  ${description.join}

  ${usage.leave}
  ${description.leave}

  ${usage.volume}
  ${description.volume}

  ${usage.mute}
  ${description.mute}

  ${usage.bass}
  ${description.bass}

  ${usage.treble}
  ${description.treble}

  ${usage.loudness}
  ${description.loudness}

  ${usage.balance}
  ${description.balance}

  ${usage.nightSound}
  ${description.nightSound}

  ${usage.speechEnhancement}
  ${description.speechEnhancement}

  ${usage.surroundEnable}
  ${description.surroundEnable}

  ${usage.tvLevel}
  ${description.tvLevel}

  ${usage.musicLevel}
  ${description.musicLevel}

  ${usage.musicPlaybackFull}
  ${description.musicPlaybackFull}

  ${usage.heightLevel}
  ${description.heightLevel}

  ${usage.subEnable}
  ${description.subEnable}

  ${usage.subLevel}
  ${description.subLevel}

  ${usage.led}
  ${description.led}

  ${usage.buttonLock}
  ${description.buttonLock}

For more help, issue: ${b('zp')} ${u('command')} ${b('-h')}`,
  info: `${description.info}

Usage: ${b('zp')} ${usage.info}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('-n')}, ${b('--noWhiteSpace')}
  Do not include spaces nor newlines in JSON output.

  ${b('-v')}. ${b('--verbose')}
  Verbose.  Include topology info.`,
  description: `${description.description}

Usage: ${b('zp')} ${usage.description}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('-n')}, ${b('--noWhiteSpace')}
  Do not include spaces nor newlines in JSON output.

  ${b('-S')}, ${b('--scpd')}
  Include service control point definitions.

  ${b('-s')}, ${b('--sortKeys')}
  Sort JSON object key/value pairs alphabetically on key.`,
  topology: `${description.topology}

Usage: ${b('zp')} ${usage.topology}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('-n')}, ${b('--noWhiteSpace')}
  Do not include spaces nor newlines in JSON output.

  ${b('-p')}, ${b('--playersOnly')}
  Do not include zones in the output.

  ${b('-r')}, ${b('--raw')}
  Output the raw zone group state.

  ${b('-v')}, ${b('--verify')}
  Verify that each zone player can be reached.
  Include the device description information for reachable zone players.`,
  eventlog: `${description.eventlog}

Usage: ${b('zp')} ${usage.eventlog}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('-n')}, ${b('--noWhiteSpace')}
  Do not include spaces nor newlines in JSON output.

  ${b('-s')}, ${b('--service')}
  Do not output timestamps (useful when running as service).

  ${b('-t')}, ${b('--topology')}
  Show only parsed ZoneGroupTopology events, to monitor topology changes.`,
  browse: `${description.browse}
Returns a list of media items with ${u('object')} for browsing or ${u('uri')} for playing.

Usage: ${b('zp')} ${usage.browse}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('-n')}, ${b('--noWhiteSpace')}
  Do not include spaces nor newlines in JSON output.

  ${u('object')}
  Browse ${u('object')} instead of default (top level).
  Use ${b('zp browse')} to obtain the value for ${u('object')}.`,
  play: `${description.play}

Usage: ${b('zp')} ${usage.play}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${u('uri')}
  Set source to ${u('uri')}.
  Use ${b('zp browse')} to obtain the value for ${u('uri')}.

  ${u('meta')}
  Set meta data for source to ${u('meta')}.
  Use ${b('zp browse')} to obtain the value for ${u('meta')}.`,
  queue: `${description.queue}

Usage: ${b('zp')} ${usage.queue}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${u('uri')}
  Set source to ${u('uri')}.
  Use ${b('zp browse')} to obtain the value for ${u('uri')}.

  ${u('meta')}
  Set meta data for source to ${u('meta')}.
  Use ${b('zp browse')} to obtain the value for ${u('meta')}.`,
  pause: `${description.pause}

Usage: ${b('zp')} ${usage.pause}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.`,
  stop: `${description.stop}

Usage: ${b('zp')} ${usage.stop}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.`,
  next: `${description.next}

Usage: ${b('zp')} ${usage.stop}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.`,
  previous: `${description.previous}

Usage: ${b('zp')} ${usage.previous}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.`,
  crossfade: `${description.crossfade}

Usage: ${b('zp')} ${usage.crossfade}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('on')}
  Set crossfade.

  ${b('off')}
  Clear crossfade.`,
  repeat: `${description.repeat}

Usage: ${b('zp')} ${usage.repeat}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('on')}
  Repeat all tracks.

  ${b('1')}
  Repeat current track.

  ${b('off')}
  Clear repeat.`,
  shuffle: `${description.shuffle}

Usage: ${b('zp')} ${usage.shuffle}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('on')}
  Set shuffle.

  ${b('off')}
  Clear shuffle.`,
  sleepTimer: `${description.sleepTimer}

Usage: ${b('zp')} ${usage.sleepTimer}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${u('time')}
  Set sleep timer to ${u('time')} (from ${b('00:00:00')} to ${b('23:59:59')}).

  ${b('off')}
  Clear sleep timer.`,
  groupVolume: `${description.groupVolume}

Usage: ${b('zp')} ${usage.groupVolume}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${u('volume')}
  Set group volume to ${u('volume')} (from 0 to 100).`,
  groupMute: `${description.groupMute}

Usage: ${b('zp')} ${usage.groupMute}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('on')}
  Set group mute.

  ${b('off')}
  Clear group mute.`,
  join: `${description.join}

Usage: ${b('zp')} ${usage.join}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${u('zone')}
  Join ${u('zone')}'s group.`,
  leave: `${description.leave}

Usage: ${b('zp')} ${usage.leave}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.`,
  volume: `${description.volume}

Usage: ${b('zp')} ${usage.volume}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${u('volume')}
  Set volume to ${u('volume')} (from 0 to 100).`,
  mute: `${description.mute}

Usage: ${b('zp')} ${usage.mute}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('on')}
  Set mute.

  ${b('off')}
  Clear mute.`,
  bass: `${description.bass}

Usage: ${b('zp')} ${usage.bass}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${u('bass')}
  Set bass to ${u('bass')} (from -10 to 10).`,
  treble: `${description.treble}

Usage: ${b('zp')} ${usage.treble}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${u('treble')}
  Set treble to ${u('treble')} (from -10 to 10).`,
  loudness: `${description.loudness}

Usage: ${b('zp')} ${usage.loudness}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('on')}
  Set loudness.

  ${b('off')}
  Clear loudness.`,
  balance: `${description.balance}

Usage: ${b('zp')} ${usage.balance}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${u('balance')}
  Set balance to ${u('balance')} (from -100 to 100).`,
  nightSound: `${description.nightSound}

Usage: ${b('zp')} ${usage.nightSound}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('on')}
  Set night sound.

  ${b('off')}
  Clear night sound.`,
  speechEnhancement: `${description.speechEnhancement}

Usage: ${b('zp')} ${usage.speechEnhancement}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('on')}
  Set speech enhancement.

  ${b('off')}
  Clear speech enhancement.`,
  surroundEnable: `${description.surroundEnable}

Usage: ${b('zp')} ${usage.surroundEnable}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('on')}
  Enable surround speakers.

  ${b('off')}
  Disable surround speakers.`,
  tvLevel: `${description.tvLevel}

Usage: ${b('zp')} ${usage.tvLevel}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${u('level')}
  Set TV surround level to ${u('level')} (from -15 to 15).`,
  musicLevel: `${description.musicLevel}

Usage: ${b('zp')} ${usage.musicLevel}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${u('level')}
  Set music surround level to ${u('level')} (from -15 to 15).`,
  musicPlaybackFull: `${description.musicPlaybackFull}

Usage: ${b('zp')} ${usage.musicPlaybackFull}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('on')}
  Set music playback to full.

  ${b('off')}
  Set music playback to ambient.`,
  heightLevel: `${description.heightLevel}

Usage: ${b('zp')} ${usage.heightLevel}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${u('level')}
  Set height channel level to ${u('level')} (from -10 to 10).`,
  subEnable: `${description.subEnable}

Usage: ${b('zp')} ${usage.subEnable}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('on')}
  Enable Sub.

  ${b('off')}
  Disable Sub.`,
  subLevel: `${description.subLevel}

Usage: ${b('zp')} ${usage.subLevel}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${u('level')}
  Set Sub level to ${u('level')} (from -15 to 15).`,
  led: `${description.led}

Usage: ${b('zp')} ${usage.led}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('on')}
  Set ZonePlayer LED on.

  ${b('off')}
  Set ZonePlayer LED off.`,
  buttonLock: `${description.buttonLock}

Usage: ${b('zp')} ${usage.buttonLock}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('on')}
  Set ZonePlayer button lock state (i.e. disable ZonePlayer buttons).

  ${b('off')}
  Clear ZonePlayer button lock state (i.e. enable ZonePlayer buttons).`
}

const unsupportedServices = [
  'ConnectionManager', // No useful information.
  'MusicServices', // Not supported by homebridge-zp.
  'QPlay', // Doesn't support SUBSCRIBE.
  'Queue' // Not supported by homebridge-zp.
]

class Main extends homebridgeLib.CommandLineTool {
  constructor () {
    super()
    this.usage = usage.zp
    this.clients = []
  }

  createZpClient (options) {
    const zpClient = new ZpClient(options)
    zpClient
      .on('error', (error) => {
        if (error.request == null) {
          this.warn(error)
          return
        }
        if (error.request.id !== this.requestId) {
          if (error.request.body == null) {
            this.log(
              '%s: request %d: %s %s', error.request.name, error.request.id,
              error.request.method, error.request.resource
            )
          } else {
            this.log(
              '%s: request %d: %s %s', error.request.name, error.request.id,
              error.request.method, error.request.resource, error.request.action
            )
          }
          this.requestId = error.request.id
        }
        this.warn(
          '%s: request %d: %s', error.request.name, error.request.id, error
        )
      })
      // TODO: never called, since no UPnP listener is active
      .on('rebooted', (oldBootSeq) => {
        this.debug(
          '%s: rebooted (%d -> %d)', zpClient.name,
          oldBootSeq, zpClient.bootSeq
        )
      })
      .on('addressChanged', (oldAddress) => {
        this.debug(
          '%s: IP address changed (%s -> %s)', zpClient.name,
          oldAddress, zpClient.address
        )
      })
      .on('request', (request) => {
        this.debug(
          '%s: request %s: %s %s%s', request.name,
          request.id, request.method, request.resource,
          request.action == null ? '' : ' ' + request.action
        )
        if (request.parsedBody != null) {
          this.vdebug(
            '%s: request %s: %s %s %j', request.name,
            request.id, request.method, request.url, request.parsedBody
          )
          this.vvdebug(
            '%s: request %s: %s %s (headers: %j) %j', request.name,
            request.id, request.method, request.url,
            request.headers, request.body
          )
        } else {
          this.vdebug(
            '%s: request %s: %s %s', request.name,
            request.id, request.method, request.url
          )
          this.vvdebug(
            '%s: request %s: %s %s (headers: %j)', request.name,
            request.id, request.method, request.url, request.headers
          )
        }
      })
      .on('response', (response) => {
        this.debug(
          '%s: request %d: %d %s', response.request.name,
          response.request.id, response.statusCode, response.statusMessage
        )
        if (response.parsedBody != null) {
          this.vvdebug(
            '%s: request %d: response (headers: %j): %j', response.request.name,
            response.request.id, response.headers, response.body
          )
          this.vdebug(
            '%s: request %d: response: %j', response.request.name,
            response.request.id, response.parsedBody
          )
        }
      })
      .on('message', (message) => {
        const notify = message.device === 'ZonePlayer'
          ? message.service
          : message.device + '/' + message.service
        this.vvdebug(
          '%s: notify %s/Event: %s', this._clargs.options.host,
          notify, message.body
        )
        this.vdebug(
          '%s: notify %s/Event: %j', this._clargs.options.host,
          notify, message.parsedBody
        )
        this.debug('%s: notify %s/Event', this._clargs.options.host, notify)
      })
    return zpClient
  }

  async main () {
    try {
      this._clargs = this.parseArguments()
      if (this._clargs.options.host == null || this._clargs.options.host === '') {
        throw new UsageError(`Missing host.  Set ${b('ZP_HOST')} or specify ${b('-H')}.`)
      }
      this.zpListener = new ZpListener()
      this.zpListener
        .on('listening', (url) => { this.debug('listening on %s', url) })
        .on('close', (url) => { this.debug('closed %s', url) })
        .on('error', (error) => { this.warn(error) })
      this._clargs.options.listener = this.zpListener
      this.zpClient = await this.createZpClient(this._clargs.options)
      await this.zpClient.init()
      this.debug(
        '%s: reached using local address %s', this._clargs.options.host,
        this.zpClient.localAddress
      )
      this.name = 'zp ' + this._clargs.command
      this.usage = `${b('zp')} ${usage[this._clargs.command]}`
      this.help = help[this._clargs.command]
      await this[this._clargs.command](this._clargs.args)
    } catch (error) {
      this.error(error)
    }
  }

  parseArguments () {
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    const clargs = {
      options: {
        host: process.env.ZP_HOST,
        timeout: 5
      }
    }
    parser
      .help('h', 'help', help.zp)
      .version('V', 'version')
      .flag('D', 'debug', () => {
        if (this.vdebugEnabled) {
          this.setOptions({ vvdebug: true })
        } else if (this.debugEnabled) {
          this.setOptions({ vdebug: true })
        } else {
          this.setOptions({ debug: true, chalk: true })
        }
      })
      .option('H', 'host', (value) => {
        homebridgeLib.OptionParser.toHost('host', value, false, true)
        clargs.options.host = value
      })
      .option('t', 'timeout', (value) => {
        clargs.options.timeout = homebridgeLib.OptionParser.toInt(
          'timeout', value, 1, 60, true
        )
      })
      .parameter('command', (value) => {
        if (usage[value] == null || typeof this[value] !== 'function') {
          throw new UsageError(`${value}: unknown command`)
        }
        clargs.command = value
      })
      .remaining((list) => { clargs.args = list })
      .parse()
    return clargs
  }

  async destroy () {
    await this.zpClient.close()
  }

  async info (...args) {
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    const clargs = {
      options: { sortKeys: true }
    }
    parser.help('h', 'help', this.help)
    parser.flag('n', 'noWhiteSpace', () => {
      clargs.options.noWhiteSpace = true
    })
    parser.flag('v', 'verbose', () => { clargs.verbose = true })
    parser.parse(...args)
    const jsonFormatter = new homebridgeLib.JsonFormatter(clargs.options)
    if (clargs.verbose) {
      await this.zpClient.initTopology()
    }
    this.print(jsonFormatter.stringify(this.zpClient.info))
  }

  async description (...args) {
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    const clargs = {
      options: {}
    }
    parser.help('h', 'help', this.help)
    parser.flag('n', 'noWhiteSpace', () => {
      clargs.options.noWhiteSpace = true
    })
    parser.flag('S', 'scpd', () => { clargs.scpd = true })
    parser.flag('s', 'sortKeys', () => { clargs.options.sortKeys = true })
    parser.parse(...args)
    const jsonFormatter = new homebridgeLib.JsonFormatter(clargs.options)
    const response = this.zpClient.description
    if (clargs.scpd) {
      const devices = [response.device]
        .concat(response.device.deviceList)
      for (const device of devices) {
        for (const service of device.serviceList) {
          service.scpd = await this.zpClient.get(service.scpdUrl)
        }
      }
    }
    const json = jsonFormatter.stringify(response)
    this.print(json)
  }

  async _getInfo (zonePlayer) {
    const zpClient = this.createZpClient({
      host: zonePlayer.address,
      id: zonePlayer.id,
      timeout: this._clargs.options.timeout
    })
    await zpClient.init()
    await zpClient.initTopology(this.zpClient)
    return zpClient.info
  }

  async topology (...args) {
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    const clargs = {
      options: {}
    }
    parser.help('h', 'help', this.help)
    parser.flag('n', 'noWhiteSpace', () => {
      clargs.options.noWhiteSpace = true
    })
    parser.flag('p', 'playersOnly', () => { clargs.players = true })
    parser.flag('r', 'raw', () => { clargs.raw = true })
    parser.flag('v', 'verify', () => { clargs.verify = true })
    parser.parse(...args)
    const jsonFormatter = new homebridgeLib.JsonFormatter(clargs.options)
    await this.zpClient.initTopology()
    let result = {}
    if (clargs.verify) {
      const zonePlayers = this.zpClient.zonePlayers
      const jobs = []
      for (const id in zonePlayers) {
        if (id === this.zpClient.id) {
          result[id] = this.zpClient.info
        } else {
          result[id] = undefined
          const zonePlayer = this.zpClient.zonePlayers[id]
          if (zonePlayer == null) {
            delete result[id]
            this.error('%s: zone player not found', id)
            continue
          }
          jobs.push(this._getInfo(zonePlayer)
            .then((info) => {
              result[id] = info
            }).catch(() => {
              // delete result[id]
            })
          )
        }
      }
      for (const job of jobs) {
        await job
      }
      if (!clargs.players) {
        result = ZpClient.unflatten(result)
      }
    } else if (clargs.players) {
      result = this.zpClient.zonePlayers
    } else if (clargs.raw) {
      result = this.zpClient.zoneGroupState
    } else {
      result = this.zpClient.zones
    }
    const json = jsonFormatter.stringify(result)
    this.print(json)
  }

  async eventlog (...args) {
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    const clargs = {
      mode: 'daemon',
      options: {}
    }
    parser.help('h', 'help', this.help)
    parser.flag('n', 'noWhiteSpace', () => {
      clargs.options.noWhiteSpace = true
    })
    parser.flag('s', 'service', () => { clargs.mode = 'service' })
    parser.flag('t', 'topology', () => { clargs.topology = true })
    parser.parse(...args)
    this.setOptions({ mode: clargs.mode })
    const jsonFormatter = new homebridgeLib.JsonFormatter(clargs.options)
    this.zpClient
      .on('message', (message) => {
        if (clargs.topology) {
          if (message.service === 'ZoneGroupTopology') {
            this.log(
              '%s: topology %s', this._clargs.options.host,
              jsonFormatter.stringify(this.zpClient.zones)
            )
          }
        } else {
          this.log(
            '%s: %s %s event: %s', this._clargs.options.host,
            message.device, message.service,
            jsonFormatter.stringify(message.parsedBody)
          )
        }
      })
    await this.zpClient.open()
    if (clargs.topology) {
      try {
        await this.zpClient.subscribe('/ZoneGroupTopology/Event')
      } catch (error) {
        this.error(error)
      }
    } else {
      const description = this.zpClient.description
      const deviceList = [description.device].concat(description.device.deviceList)
      for (const device of deviceList) {
        for (const service of device.serviceList) {
          const serviceName = service.serviceId.split(':')[3]
          if (unsupportedServices.includes(serviceName)) {
            continue
          }
          try {
            await this.zpClient.subscribe(service.eventSubUrl)
          } catch (error) {
            this.error(error)
          }
        }
      }
    }
  }

  async browse (...args) {
    const clargs = { options: {} }
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    parser.help('h', 'help', this.help)
    parser.flag('n', 'noWhiteSpace', () => {
      clargs.options.noWhiteSpace = true
    })
    parser.remaining((list) => {
      if (list.length > 1) {
        throw new UsageError('too many arguments')
      }
      clargs.object = list[0]
    })
    parser.parse(...args)
    const jsonFormatter = new homebridgeLib.JsonFormatter(clargs.options)
    await this.zpClient.initTopology()
    let result
    if (clargs.object == null) {
      result = {
        'Music Library': { browse: 'A:' },
        'Music Library Servers': { browse: 'S:' },
        'Sonos Favorites': { browse: 'FV:' },
        'Sonos Playlists': { browse: 'SQ:' },
        'Sonos Queues': { browse: 'Q:' }
      }
      if (this.zpClient.airPlay) {
        result.AirPlay = {
          uri: 'x-sonosapi-vli:' + this.zpClient.id
        }
      }
      if (this.zpClient.audioIn) {
        result['Audio In'] = {
          uri: 'x-rincon-stream:' + this.zpClient.id
        }
      }
      if (this.zpClient.tvIn) {
        result.TV = {
          uri: 'x-sonos-htastream:' + this.zpClient.id + ':spdif'
        }
      }
    } else {
      result = await this.zpClient.browse(clargs.object)
    }
    const json = jsonFormatter.stringify(result)
    this.print(json)
  }

  async play (...args) {
    let uri
    let meta
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    parser.help('h', 'help', this.help)
    parser.remaining((list) => {
      if (list.length > 2) {
        throw new UsageError('too many arguments')
      }
      uri = list[0]
      meta = list[1]
    })
    parser.parse(...args)
    if (uri != null) {
      await this.zpClient.setAvTransportUri(uri, meta)
    }
    await this.zpClient.play()
  }

  async queue (...args) {
    let uri
    let meta
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    parser.help('h', 'help', this.help)
    parser.parameter('uri', (value) => {
      uri = value
    })
    parser.remaining((list) => {
      if (list.length > 1) {
        throw new UsageError('too many arguments')
      }
      meta = list[0]
    })
    parser.parse(...args)
    await this.zpClient.setAvTransportQueue(uri, meta)
  }

  async pause (...args) { return this.simpleCommand('pause', ...args) }

  async stop (...args) { return this.simpleCommand('stop', ...args) }

  async next (...args) { return this.simpleCommand('next', ...args) }

  async previous (...args) { return this.simpleCommand('previous', ...args) }

  async crossfade (...args) { return this.onOffCommand('CrossfadeMode', ...args) }

  async repeat (...args) {
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    let repeat
    parser.help('h', 'help', this.help)
    parser.remaining((list) => {
      if (list.length > 1) {
        throw new UsageError('too many arguments')
      }
      if (list.length === 1) {
        if (['on', '1', 'off'].includes(list[0])) {
          repeat = list[0]
        } else {
          throw new UsageError(`${list[0]}: invalid repeat value`)
        }
      }
    })
    parser.parse(...args)
    if (repeat != null) {
      await this.zpClient.setRepeat(repeat)
    }
    this.print(await this.zpClient.getRepeat())
  }

  async shuffle (...args) { return this.onOffCommand('Shuffle', ...args) }

  async sleepTimer (...args) {
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    let duration
    parser.help('h', 'help', this.help)
    parser.remaining((list) => {
      if (list.length > 1) {
        throw new UsageError('too many arguments')
      }
      if (list.length === 1) {
        if (/^(:?2[0-3]|[01][0-9]):[0-5][0-9]:[0-5][0-9]$/.test(list[0])) {
          duration = list[0]
        } else if (list[0] === 'off') {
          duration = ''
        } else {
          throw new UsageError(`${list[0]}: invalid duration`)
        }
      }
    })
    parser.parse(...args)
    if (duration != null) {
      await this.zpClient.setSleepTimer(duration)
    }
    const timer = await this.zpClient.getSleepTimer()
    this.print(timer === '' ? 'off' : timer)
  }

  async groupVolume (...args) { return this.valueCommand('GroupVolume', 0, 100, ...args) }

  async groupMute (...args) { return this.onOffCommand('GroupMute', ...args) }

  async join (...args) {
    let coordinator
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    parser.help('h', 'help', this.help)
    parser.parameter('zone', (value) => {
      coordinator = value
    })
    parser.parse(...args)
    await this.zpClient.initTopology()
    for (const id in this.zpClient.zones) {
      if (this.zpClient.zones[id].zoneName === coordinator) {
        return this.zpClient.setAvTransportUri('x-rincon:' + id)
      }
    }
    throw new Error(`${coordinator}: zone not found`)
  }

  async leave (...args) { return this.simpleCommand('becomeCoordinatorOfStandaloneGroup', ...args) }

  async volume (...args) { return this.valueCommand('Volume', 0, 100, ...args) }

  async mute (...args) { return this.onOffCommand('Mute', ...args) }

  async bass (...args) { return this.valueCommand('Bass', -10, 10, ...args) }

  async treble (...args) { return this.valueCommand('Treble', -10, 10, ...args) }

  async balance (...args) { return this.valueCommand('Balance', -100, 100, ...args) }

  async loudness (...args) { return this.onOffCommand('Loudness', ...args) }

  async nightSound (...args) { return this.onOffCommand('NightSound', ...args) }

  async speechEnhancement (...args) { return this.onOffCommand('SpeechEnhancement', ...args) }

  async surroundEnable (...args) { return this.onOffCommand('SurroundEnable', ...args) }

  async tvLevel (...args) { return this.valueCommand('TvLevel', -15, 15, ...args) }

  async musicLevel (...args) { return this.valueCommand('MusicLevel', -15, 15, ...args) }

  async musicPlaybackFull (...args) { return this.onOffCommand('MusicPlaybackFull', ...args) }

  async heightLevel (...args) { return this.valueCommand('HeightLevel', -10, 10, ...args) }

  async subEnable (...args) { return this.onOffCommand('SubEnable', ...args) }

  async subLevel (...args) { return this.valueCommand('SubLevel', -15, 15, ...args) }

  async led (...args) { return this.onOffCommand('LedState', ...args) }

  async buttonLock (...args) { return this.onOffCommand('ButtonLockState', ...args) }

  async simpleCommand (command, ...args) {
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    parser.help('h', 'help', this.help)
    parser.parse(...args)
    return this.zpClient[command]()
  }

  async valueCommand (command, min, max, ...args) {
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    let value
    parser.help('h', 'help', this.help)
    parser.remaining((list) => {
      if (list.length > 1) {
        throw new UsageError('too many arguments')
      }
      if (list.length === 1) {
        value = homebridgeLib.OptionParser.toInt(
          command.toLowerCase(), list[0], min, max, true
        )
      }
    })
    parser.parse(...args)
    if (value != null) {
      await this.zpClient['set' + command](value)
    }
    this.print('' + await this.zpClient['get' + command]())
  }

  async onOffCommand (command, ...args) {
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    let value
    if (args.length > 1) {
      throw new UsageError('too many arguments')
    }
    parser.help('h', 'help', this.help)
    parser.remaining((list) => {
      if (list.length > 1) {
        throw new UsageError('too many arguments')
      }
      if (list.length === 1) {
        value = homebridgeLib.OptionParser.toBool(
          command.toLowerCase(), list[0], true
        )
      }
    })
    parser.parse(...args)
    if (value != null) {
      await this.zpClient['set' + command](value)
    }
    this.print((await this.zpClient['get' + command]()) ? 'on' : 'off')
  }
}

new Main().main()
