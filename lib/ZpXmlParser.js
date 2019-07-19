// homebridge-zp/lib/ZpXmlParser.js
// Copyright © 2019 Erik Baauw. All rights reserved.
//
// Homebridge plugin for Sonos ZonePlayer.

'use strict'

const debug = require('debug')
const he = require('he')
const xml2js = require('xml2js')

// Words in uppercase to be converted to camelcase.
const _upperCaseWords = [
  'DIDL-Lite',
  'EQ',
  'HT',
  'IP',
  'IR',
  'LED',
  'LF',
  'MAC',
  'RF',
  'SCPD',
  'SSID',
  'TOS',
  'TV',
  'UDN',
  'URI',
  'URL',
  'UUID',
  'ID'
]
const upperCaseWords = {}
for (const word of _upperCaseWords) {
  upperCaseWords[word] = {
    regexp: new RegExp('^(.*)' + word + '(.*)$'),
    lower: word.toLowerCase(),
    camel: word.charAt(0) + word.slice(1).toLowerCase()
  }
}

// Keys that might hold an HTML encoded value.
const encodedKeys = [
  'streamContent',
  'title'
]

// Keys that always hold a string value.
const stringKeys = [
  'album',
  'title'
]

// Keys to be replaced.
const replacementKeys = {
  availableSoftwareUpdate: 'availableSoftwareUpdates',
  satellite: 'satellites',
  zoneGroupMember: 'zoneGroupMembers'
}

// Keys that contain lists and always should return an array.
// Value is the member key, or empty sting if none.
const arrayKeys = {
  availableSoftwareUpdates: 'updateItem',
  currentAlarmList: 'alarm',
  lastChange: '',
  queueId: '',
  satellites: '',
  serviceStateTable: 'stateVariable',
  vanishedDevices: 'device',
  zoneGroups: 'zoneGroup',
  zoneGroupMembers: ''
}

// Keys to be ignore at root.
const rootKeys = [
  'alarms',
  'didl-lite',
  'e:propertyset',
  'event',
  'instanceId',
  'item',
  'root',
  'scpd',
  'val',
  'zoneGroupState'
]

// Keys with one or more channels.
const channelKeys = [
  'loudness',
  'mute',
  'volume'
]

// XML parser
class ZpXmlParser {
  constructor () {
    const xml2jsParserOptions = {
      explicitArray: false,
      mergeAttrs: true,
      attrNameProcessors: [this._processKey.bind(this)],
      attrValueProcessors: [this._processValue.bind(this)],
      tagNameProcessors: [this._processKey.bind(this)],
      valueProcessors: [this._processValue.bind(this)]
    }
    this._parser = new xml2js.Parser(xml2jsParserOptions)
    this._debug = debug('ZpXmlParser')
  }

  async parse (xml) {
    return new Promise((resolve, reject) => {
      // this._debug('parse(%j)', xml)
      this._parser.parseString(xml, async (error, result) => {
        if (error != null) {
          return reject(error)
        }
        // this._debug('parse(%j) => %j', xml, result)
        return resolve(this._process(result))
      })
    })
  }

  // Convert key to javascript standard key.
  _processKey (key) {
    const oldKey = key
    this._debug('processKey(%j)', oldKey)

    // Get rid of schema tags.
    const a = key.split(':')
    if (a != null && a.length === 2 && a[0] !== 'xmlns' && a[0] !== 'e' && a[0] !== 's') {
      key = a[1]
    }

    // Convert uppercase keys to camelcase.
    for (const wordKey in upperCaseWords) {
      const word = upperCaseWords[wordKey]
      const a = word.regexp.exec(key)
      if (a != null) {
        key = a[1] + (a[1] === '' ? word.lower : word.camel) + a[2]
      }
    }

    // Convert initial uppercase to lowercase.
    key = key.charAt(0).toLowerCase() + key.slice(1)

    // Substite keys.
    if (replacementKeys[key] != null) {
      key = replacementKeys[key]
    }

    this._debug('processKey(%j) => %j', oldKey, key)
    return key
  }

  // Convert value to proper javascript value.
  _processValue (value, key) {
    const oldValue = value
    this._debug('processValue(%j, %j)', oldValue, key)

    // Convert integer string to integer
    if (/^[0-9]+$/.test(value) && !stringKeys.includes(key)) {
      value = parseInt(value)
    }

    if (encodedKeys.includes(key)) {
      value = he.decode(value)
    }

    this._debug('processValue(%j, %j) => %j', oldValue, key, value)
    return value
  }

  // Post-process converted XML.
  async _process (value) {
    // Recursively parse XML strings.
    if (typeof value === 'string' && /^<.*>$/.test(value)) {
      return this.parse(value)
    }

    // Recursively post-process arrays.
    if (Array.isArray(value)) {
      const list = []
      for (const elt of value) {
        list.push(await this._process(elt))
      }
      return list
    }

    // Recursively post-process objects.
    if (typeof value === 'object') {
      // Ignore xmlns schemas.
      for (const key in value) {
        if (key.startsWith('xmlns')) {
          delete value[key]
        }
      }
      // Handle single-key objects.
      const keys = Object.keys(value)
      if (keys.length === 1) {
        if (rootKeys.includes(keys[0])) {
          return this._process(value[keys[0]])
        }
      }
      // Recursively post-process key/value pairs.
      const obj = {}
      for (const key in value) {
        // Handle lists.
        const a = key.match(/^(.+)List$/)
        if (a != null || arrayKeys[key] != null) {
          const childKey = arrayKeys[key] == null ? a[1] : arrayKeys[key]
          let newValue = await this._process(value[key])
          const listKeys = Object.keys(newValue)
          if (listKeys.length === 1 && listKeys[0] === childKey) {
            newValue = newValue[childKey]
          }
          if (Array.isArray(newValue)) {
            obj[key] = newValue
          } else if (typeof newValue === 'object') {
            obj[key] = [newValue]
          } else {
            obj[key] = []
          }
          continue
        }
        // Handle e:property.
        if (key === 'e:property') {
          const newValue = await this._process(value[key])
          if (Array.isArray(newValue)) {
            for (const property of newValue) {
              for (const key in property) {
                obj[key] = property[key]
              }
            }
          } else {
            for (const key in newValue) {
              obj[key] = newValue[key]
            }
          }
          continue
        }
        // Handle SOAP response.
        if (key === 's:Envelope') {
          if (value[key] != null && value[key]['s:Body'] != null) {
            const keys = Object.keys(value[key]['s:Body'])
            const newValue = await this._process(
              keys.length === 1
                ? value[key]['s:Body'][keys[0]]
                : value[key]['s:Body']
            )
            for (const key in newValue) {
              obj[key] = newValue[key]
            }
            continue
          }
        }
        // Handle keys (like volume) with multiple channels.
        if (channelKeys.includes(key) && typeof value[key] === 'object') {
          obj[key] = {}
          const newValue = [].concat(await this._process(value[key]))
          for (const elt of newValue) {
            obj[key][this._processKey(elt.channel)] = elt.val
          }
          continue
        }
        obj[key] = await this._process(value[key])
      }
      return obj
    }

    return value
  }
}

module.exports = ZpXmlParser
