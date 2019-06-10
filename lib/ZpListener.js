// homebridge-zp/lib/ZpListener.js
// Copyright © 2019 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

const debug = require('debug')
const events = require('events')
const http = require('http')
const os = require('os')
const ZpXmlParser = require('./ZpXmlParser')

class ZpListener extends events.EventEmitter {
  // Convert string with IP address to int.
  static ipToInt (ipaddress) {
    const a = ipaddress.split('.')
    return a[0] << 24 | a[1] << 16 | a[2] << 8 | a[3]
  }

  // Check whether ip1 and ip2 are in the same network.
  static inSameNetwork (ip1, ip2, netmask) {
    return (ZpListener.ipToInt(ip1) & ZpListener.ipToInt(netmask)) ===
           (ZpListener.ipToInt(ip2) & ZpListener.ipToInt(netmask))
  }

  // Find my address for network of ip.
  static findMyAddressFor (ip) {
    const interfaces = os.networkInterfaces()
    for (const id in interfaces) {
      const aliases = interfaces[id]
      for (const aid in aliases) {
        const alias = aliases[aid]
        if (
          alias.family === 'IPv4' && alias.internal === false &&
          ZpListener.inSameNetwork(ip, alias.address, alias.netmask)
        ) {
          return alias.address
        }
      }
    }
    return '0.0.0.0'
  }

  constructor () {
    super()
    this._debug = debug('ZpListener')
    this._clients = {}
    this._parser = new ZpXmlParser()
    this._server = http.createServer((request, response) => {
      let buffer = ''
      request.on('data', (data) => {
        buffer += data
      })
      request.on('end', async () => {
        try {
          request.body = buffer
          this._debug('%s %s', request.method, request.url)
          if (request.method === 'GET' && request.url === '/notify') {
            // Provide an easy way to check that listener is reachable.
            response.writeHead(200, { 'Content-Type': 'text/plain' })
            response.write(
              `listening to ${Object.keys(this._clients).length} clients`
            )
          } else if (request.method === 'NOTIFY') {
            const array = request.url.split('/')
            if (array.length === 5) {
              array.splice(3, 0, 'ZonePlayer')
            }
            const client = this._clients[array[2]]
            if (
              array[1] === 'notify' && client !== null &&
              array[3] != null && array[4] != null
            ) {
              this._debug('%s %s event: %s', array[3], array[4], request.body)
              const payload = await this._parser.parse(request.body)
              this._debug('%s %s event: %j', array[3], array[4], payload)
              client.emit('event', array[3], array[4], payload)
            }
          }
          response.end()
        } catch (error) {
          this.emit('error', error)
        }
      })
    })
    this._server.on('error', (error) => { this.emit('error', error) })
  }

  async _listen (ipAddress) {
    return new Promise((resolve, reject) => {
      if (this._callbackUrl != null) {
        return resolve()
      }
      this._debug('_listen(%j)', ipAddress)
      try {
        const myIp = ZpListener.findMyAddressFor(ipAddress)
        this._server.listen(0, myIp, () => {
          const address = this._server.address()
          const host = address.address + ':' + address.port
          this._callbackUrl = 'http://' + host + '/notify'
          this.emit('listening', this._callbackUrl)
          this._debug('_listen(%j) => %j', ipAddress, this._callbackUrl)
          return resolve()
        })
      } catch (error) {
        return reject(error)
      }
    })
  }

  async addClient (zpClient) {
    this._debug('addClient(%j)', zpClient)
    this._clients[zpClient._id] = zpClient
    await this._listen(zpClient._ipAddress)
    const callbackUrl = this._callbackUrl + '/' + zpClient._id
    this._debug('addClient(%j) => %j', zpClient, callbackUrl)
    return callbackUrl
  }
}

module.exports = ZpListener
