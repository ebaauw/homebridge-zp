// homebridge-zp/lib/ZpListener.js
// Copyright © 2019-2023 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

const events = require('events')
const http = require('http')

/** Listener class for receiving notifications by Sonos zone players.
  *
  * This class implements a web server to receive notifications from Sonos
  * zone players.
  * The web server can handle notifications from multiple zone players.
  *
  * Use {@link ZpListener#addClient addClient()} to register a zone player.
  * When a notification for a registered zone player is recevied, a
  * {@link ZpListener#event:notify notify} event
  * is issued, using the zone player ID as event name.
  *
  * Use {@link ZpListener#removeClient removeClient()} to unregister a
  * zone player.
  * @extends EventEmitter
  */
class ZpListener extends events.EventEmitter {
  /** Create a new listener instance.
    * @param {integer} [port=0] - The port for the web server.
    */
  constructor (port = 0) {
    super()
    this._myPort = port
    this._clients = {}
    this._server = http.createServer((request, response) => {
      let buffer = ''
      request.on('data', (data) => {
        buffer += data
      })
      request.on('end', async () => {
        try {
          request.body = buffer
          if (request.method === 'GET' && request.url === '/notify') {
            // Provide an easy way to check that listener is reachable.
            response.writeHead(200, { 'Content-Type': 'text/html' })
            response.write('<table>')
            response.write(`<caption><h3>Listening to ${Object.keys(this._clients).length} clients</h3></caption>`)
            response.write('<tr><th scope="col">ZonePlayer</th>')
            // response.write('<th scope="col">ID</th>')
            response.write('<th scope="col">IP Address</th>')
            response.write('<th scope="col">Local IP Address</th>')
            response.write('<th scope="col">Subscriptions</th></tr>')
            const names = {}
            for (const id of Object.keys(this._clients)) {
              const zpClient = this._clients[id]
              const name = zpClient.name == null ? zpClient.id : zpClient.name
              names[name] = zpClient
            }
            for (const name of Object.keys(names).sort()) {
              const zpClient = names[name]
              response.write(`<tr><td>${name}</td>`)
              // response.write(`<td>${zpClient.id}</td>`)
              response.write(`<td>${zpClient.address}</td>`)
              response.write(`<td>${zpClient.localAddress}</td>`)
              const subs = zpClient.subscriptions.map((sub) => {
                return sub.slice(0, -6)
              }).join(', ')
              response.write(`<td>${subs}</td></tr>`)
            }
            response.write('</table>')
          } else if (request.method === 'NOTIFY') {
            const array = request.url.split('/')
            if (array.length === 5) {
              array.splice(3, 0, 'ZonePlayer')
            }
            if (
              array[1] === 'notify' && this._clients[array[2]] !== null &&
              array[3] != null && array[4] != null && array[5] === 'Event'
            ) {
              /** Emitted when receiving a notification from a registered
                * zone player.
                *
                * Note: the actual event name is the ID of the zone player.
                * @event ZpListener#notify
                * @param {object} params - The notification paramaters.
                * @param {string} params.device - The device that issued the
                * notification or `ZonePlayer` for the default device.
                * @param {string} params.service - The service that issued the
                * notification.
                * @param {string} params.body - The body of the notification
                * (in XML).
                */
              this.emit(array[2], {
                device: array[3],
                service: array[4],
                body: request.body
              })
            }
          }
          response.end()
        } catch (error) {
          /** Emitted when the web server encounters an error.
            * @event ZpListener#error
            * @param {Error} error - The error.
            */
          this.emit('error', error)
        }
      })
    })
    this._server
      .on('error', (error) => { this.emit('error', error) })
      .on('close', () => {
        /** Emitted when the web server is closed.
          * @event ZpListener#close
          * @param {string} url - The url the web server was listening on.
          */
        this.emit('close', this._callbackUrl)
        delete this._callbackUrl
      })
  }

  // Start the web server.
  async _listen () {
    if (this._server.listening) {
      return
    }
    this._server.listen(this._myPort, '0.0.0.0')
    await events.once(this._server, 'listening')
    const address = this._server.address()
    this._myIp = address.address
    this._myPort = address.port
    this._callbackUrl = 'http://' + this._myIp + ':' + this._myPort + '/notify'
    /** Emitted when the web server has started.
      * @event ZpListener#listening
      * @param {string} url - The url the web server is listening on.
      */
    this.emit('listening', this._callbackUrl)
  }

  /** Registers a zone player for notifications.
    *
    * Starts the web server if not already started.
    * @param {ZpClient} zpClient - The {@link ZpClient} instance for the zone
    * player.
    * @return {string} callbackUrl - The callback url to pass to the zone
    * player when subscribing to notifications.
    * See {@link ZpClient#subscribe subscribe()}.
    */
  async addClient (zpClient) {
    this._clients[zpClient.id] = zpClient
    await this._listen()
    const callbackUrl = 'http://' + zpClient.localAddress + ':' + this._myPort +
      '/notify/' + zpClient.id
    return callbackUrl
  }

  /** Deregisters a zone player for notifications.
    *
    * Stops the web server when no more clients remain.
    * @param {ZpClient} zpClient - The {@link ZpClient} instance for the zone
    * player.
    */
  async removeClient (zpClient) {
    this.removeAllListeners(zpClient.id)
    delete this._clients[zpClient.id] // FIXME: this doesn't work?!
    if (Object.keys(this._clients).length === 0) {
      await this._server.close()
    }
  }
}

module.exports = ZpListener
