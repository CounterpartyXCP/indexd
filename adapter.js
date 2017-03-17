let dbwrapper = require('./dbwrapper')
let parallel = require('run-parallel')
let { EventEmitter } = require('events')

let Blockchain = require('./blockchain')
let Mempool = require('./mempool')

function Adapter (db, rpc) {
  this.db = dbwrapper(db)
  this.emitter = new EventEmitter()
  this.emitter.setMaxListeners(Infinity)

  this.blockchain = new Blockchain(this.db, rpc)
  this.mempool = new Mempool(this.emitter, rpc)
}

Adapter.prototype.connect = function (blockId, height, callback) {
  this.blockchain.connect(blockId, height, callback)
}

Adapter.prototype.disconnect = function (blockId, height, callback) {
  this.blockchain.disconnect(blockId, height, callback)
}

// queries
Adapter.prototype.blockByTransaction = function (txId, callback) {
  this.blockchain.blockByTransaction(txId, callback)
}

Adapter.prototype.knownScript = function (scId, callback) {
  this.blockchain.knownScript(scId, (err, result) => {
    if (err) return callback(err)
    callback(null, result || this.mempool.knownScript(scId))
  })
}

Adapter.prototype.tip = function (callback) {
  this.blockchain.tip(callback)
}

Adapter.prototype.txosByScript = function (scId, height, callback) {
  let resultMap = {}

  this.blockchain.txosByScript(scId, height, (err, txosMap) => {
    if (err) return callback(err)

    Object.assign(resultMap, this.mempool.txosByScript(scId))
    callback(null, resultMap)
  })
}

Adapter.prototype.spentsFromTxo = function (txo, callback) {
  this.blockchain.spentFromTxo(txo, (err, spent) => {
    if (err && !err.notFound) return callback(err)

    // if in blockchain, ignore the mempool
    if (spent) return callback(null, [spent])

    // otherwise, could be multiple spents in the mempool
    callback(null, this.mempool.spentsFromTxo(txo))
  })
}

Adapter.prototype.transactionsByScript = function (scId, height, callback) {
  this.txosByScript(scId, height, (err, txosMap) => {
    if (err) return callback(err)

    let taskMap = {}
    for (let txoKey in txosMap) {
      let txo = txosMap[txoKey]

      taskMap[txoKey] = (next) => this.spentsFromTxo(txo, next)
    }

    parallel(taskMap, (err, spentMap) => {
      if (err) return callback(err)

      let txIds = {}

      for (let x in spentMap) {
        let spents = spentMap[x]
        if (!spents) continue

        spents.forEach(({ txId }) => {
          txIds[txId] = true
        })
      }

      for (let x in txosMap) {
        let { txId } = txosMap[x]
        txIds[txId] = true
      }

      callback(null, txIds)
    })
  })
}

module.exports = function makeAdapter (db, rpc) {
  return new Adapter(db, rpc)
}
