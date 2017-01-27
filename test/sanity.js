'use strict'

let test = require('tape')
let fse = require('fs-extra')
let path = require('path')

require('ngn')
require('ngn-data')
require('../')

let root = require('path').join(__dirname, './data/db.txt')

fse.emptyDirSync(path.dirname(root))

let meta = function () {
  return {
    idAttribute: 'testid',
    fields: {
      firstname: null,
      lastname: null,
      val: {
        min: 10,
        max: 20,
        default: 15
      }
    }
  }
}

test('Primary Namespace', function (t) {
  t.ok(NGNX.DATA.FileProxy !== undefined, 'NGNX.DATA.FileProxy is defined globally.')
  t.end()
})

test('Self Inspection', function (t) {
  let m = meta()
  let NewModel = new NGN.DATA.Model(m)
  let dataset = new NGN.DATA.Store({
    model: NewModel,
    proxy: new NGNX.DATA.FileProxy(root)
  })

  t.ok(dataset.proxy.type === 'store', 'Recognized store.')

  m.proxy = new NGNX.DATA.FileProxy(root)

  let TestRecord = new NGN.DATA.Model(m)
  let rec = new TestRecord({
    firstname: 'The',
    lastname: 'Doctor'
  })

  t.ok(rec.proxy.type === 'model', 'Recognized model.')
  t.end()
})

test('Cryptography for Data at Rest', function (t) {
  let m = meta()
  m.proxy = new NGNX.DATA.FileProxy({
    file: root,
    encryptionKey: 't3stK3y'
  })

  let NewModel = new NGN.DATA.Model(m)

  let record = new NewModel({
    firstname: 'The',
    lastname: 'Doctor'
  })

  let hash = record.proxy.encrypt(JSON.stringify(record.data))
  t.ok(hash !== null && hash !== undefined, 'Content successfully encrypted.')

  let out = record.proxy.decrypt(hash)
  t.ok(typeof JSON.parse(out) === 'object', 'Decrypted to object.')
  t.ok(JSON.parse(out).lastname === 'Doctor', 'Decrypted data matches unencrypted data.')

  t.end()
})
