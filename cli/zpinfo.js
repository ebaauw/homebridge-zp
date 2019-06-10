#!/usr/bin/env node

// homebridge-zp/cli/zpinfo.js
// Copyright © 2019 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

const chalk = require('chalk')
const homebridgeLib = require('homebridge-lib')
const ZpClient = require('../lib/ZpClient')
const ZpListener = require('../lib/ZpListener')
const packageJson = require('../package.json')

const b = chalk.bold
const u = chalk.underline
const usage = `${b('zpinfo')} [${b('-hVlnSs')}] [${b('-t')} ${u('timeout')}] ${u('ip')}`
const help = `Sonos ZonePlayer information.

Print the device description of a Sonos ZonePlayer as JSON.
When run as daemon or service, log Sonos ZonePlayer events as JSON.

Usage: ${usage}

Parameters:
  ${b('-h')}, ${b('--help')}
  Print this help and exit.

  ${b('-V')}, ${b('--version')}
  Print version and exit.

  ${b('-d')}, ${b('--daemon')}
  Run as daemon.  Log ZonePlayer events.

  ${b('-n')}, ${b('--noWhiteSpace')}
  Do not include spaces nor newlines in JSON output.

  ${b('-S')}, ${b('--scdp')}
  Include service control point definitions in device description.

  ${b('-s')}, ${b('--service')}
  Run as service.  Log ZonePlayer events, without timestamps.

  ${b('-t')} ${u('timeout')}, ${b('--timeout=')}${u('timeout')}
  Wait for ${u('timeout')} seconds instead of default ${b('15')}.

  ${u('ip')}
  IPv4 address of the zoneplayer.`

class Main extends homebridgeLib.CommandLineTool {
  constructor () {
    super()
    this.usage = usage
    this.options = {
      noWhiteSpace: false,
      timeout: 5
    }
    this.clients = []
  }

  parseArguments () {
    const parser = new homebridgeLib.CommandLineParser(packageJson)
    parser.help('h', 'help', help)
    parser.version('V', 'version')
    parser.flag('d', 'daemon', () => { this.options.mode = 'daemon' })
    parser.flag('n', 'noWhiteSpace', () => { this.options.noWhiteSpace = true })
    parser.flag('S', 'scdp', () => { this.options.scdp = true })
    parser.flag('s', 'service', (key) => { this.options.mode = 'service' })
    parser.option('t', 'timeout', (value, key) => {
      this.options.timeout = homebridgeLib.OptionParser.toInt(value, 1, 60, true)
    })
    // parser.parameter('hostname', (value) => { this.options.hostname = value })
    parser.remaining((value) => { this.options.hostnames = value })
    parser.parse()
  }

  async shutdown (signal) {
    this.log('Got %s, shutting down', signal)
    for (const zpClient of this.clients) {
      try {
        await zpClient.close()
      } catch (error) {
        this.error(error)
      }
    }
    process.exit(0)
  }

  async main () {
    try {
      this.parseArguments()

      const jsonOptions = { noWhiteSpace: this.options.noWhiteSpace }
      const jsonFormatter = new homebridgeLib.JsonFormatter(jsonOptions)

      if (this.options.mode) {
        this.setOptions({ mode: this.options.mode })
        process.on('SIGINT', () => { this.shutdown('SIGINT') })
        process.on('SIGTERM', () => { this.shutdown('SIGTERM') })
        this.zpListener = new ZpListener()
        this.zpListener.on('listening', (url) => {
          this.log('listening on %s', url)
        })
        this.zpListener.on('close', (url) => {
          this.log('closed %s', url)
        })
        this.zpListener.on('error', (error) => { this.error(error) })
      }

      for (const hostname of this.options.hostnames) {
        const zpClientOptions = {
          hostname: hostname,
          timeout: this.options.timeout
        }
        const zpClient = new ZpClient(zpClientOptions)
        this.clients.push(zpClient)
        const description = await zpClient.deviceDescription()
        if (this.options.mode) {
          zpClient.on('error', (error) => {
            this.error('%s: %s', zpClient.ip, error)
          })
          zpClient.on('event', (device, service, event) => {
            // this.log('%s: %s %s event', zpClient.ip, device, service)
            this.log(
              '%s: %s %s event: %s', zpClient.ip,
              device, service, jsonFormatter.format(event)
            )
          })
          await zpClient.open(this.zpListener)
        } else {
          if (this.options.scdp) {
            const devices = [description.device].concat(description.device.deviceList)
            for (const device of devices) {
              for (const service of device.serviceList) {
                service.scpd = await zpClient.deviceDescription(service.scpdUrl)
              }
            }
          }
          this.print(jsonFormatter.format(description))
          // this.print('alarms: %s', jsonFormatter.format(await zpClient.listAlarms()))
          // this.print('volume: %s', jsonFormatter.format(await zpClient.getVolume()))
          // this.print('balance: %s', jsonFormatter.format(await zpClient.getBalance()))
        }
      }
    } catch (error) {
      this.fatal(error)
    }
  }
}

new Main().main()
