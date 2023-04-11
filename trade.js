/**
 * Vela Exchange Trading Bot
 * 
 * Simple but has all you need. No guarantees.
 * 
 * Author: Ralph Kuepper, amlug.eth 
 */

require('dotenv').config();
const hre = require("hardhat");
const initialSize = 200;
const initialCollateral = 4000;
const { MYSQL_HOST, MYSQL_USER, MYSQL_DB, MYSQL_PASSWORD, ARB_API_URL, PUBLIC_KEY, PRIVATE_KEY, VELA_ADDRESS, ALC_KEY } = process.env;
const { createAlchemyWeb3 } = require("@alch/alchemy-web3");
const https = require('https');
const mysql = require('mysql2/promise');
const web3 = createAlchemyWeb3(ARB_API_URL);

const contractAbi = require("./vela-abi.json");
const contractPosAbi = require("./vela-pos-abi.json");

const ETH_ADDRESS = "0xA6E249FFB81cF6f28aB021C3Bd97620283C7335f";
const POS_VAULT_ADDRESS = "0x79e04946f0ed05a60395f3c9a4ae4a7d84eca80e";

const contract = new web3.eth.Contract(contractAbi, VELA_ADDRESS);
const contract2 = new web3.eth.Contract(contractPosAbi, POS_VAULT_ADDRESS);

async function getPositionUpdate(order) {
  let r = await contract2.methods.getPosition(order.account, order.indexToken, order.isLong, order.posId).call();
  return r;
}

let con;

const wait = async (milliseconds) => {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds);
  });
}
async function getCon() {
  if (con) {
    return con;
  }
  con = await mysql.createConnection({
    host: MYSQL_HOST,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DB
  });
  return con;
}

async function getEthPrice() {
  let con = await getCon();

  // https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=USD&include_24hr_change=true&precision=4
  const promise = new Promise(function (resolve, reject) {
    let p = "/v2/" + ALC_KEY;
    let options = {
      protocol: 'https:',
      hostname: 'api.coingecko.com',
      path: "/api/v3/simple/price?ids=ethereum&vs_currencies=USD&include_24hr_change=true&precision=4",
      headers: {
        "Content-Type": "application/json"
      }

    };
    options["method"] = "GET";


    let req = https.request(
      options, (res) => {
        let response;
        let body = '';
        //console.log("headers: ", res.rawHeaders);
        if (res.headers["link"]) {
          linkUrl = res.headers["link"];
        }

        if (res.headers['content-encoding'] === 'gzip') {
          response = res.pipe(zlib.createGunzip());
        } else {
          response = res;
        }

        response.on('data', (chunk) => {
          body += chunk;
        });

        response.on('end', async () => {
          let d = JSON.parse(body);
          console.log("D: ", d);
          let [rows, fields] = await con.execute("SELECT * FROM ethPrice WHERE createdAt <= DATE_ADD(NOW(), INTERVAL -5 MINUTE) AND createdAT >= DATE_ADD(NOW(), INTERVAL -10 MINUTE) ORDER BY createdAt DESC LIMIT 1");
          let [rows2, fields2] = await con.execute("SELECT * FROM ethPrice WHERE createdAt <= DATE_ADD(NOW(), INTERVAL -15 MINUTE) AND createdAT >= DATE_ADD(NOW(), INTERVAL -20 MINUTE) ORDER BY createdAt DESC LIMIT 1");
          let prevValue = 0;
          if (rows.length > 0) {
            prevValue = rows[0].price;
          }
          let prevValue20 = 0;
          if (rows2.length > 0) {
            prevValue20 = rows2[0].price;
          }
          let sql = "INSERT INTO ethPrice (price, createdAt) VALUES(?, NOW())";
          if (d.ethereum.usd) { await con.execute(sql, [d.ethereum.usd]); }

          d.price5MinAgo = prevValue;
          d.change = d.ethereum.usd - prevValue;
          d.price5MinAgoPercentage = (d.change / d.ethereum.usd) * 100;
          d.price20MinAgo = prevValue20;
          d.change20 = d.ethereum.usd - prevValue20;
          d.price20MinAgoPercentage = (d.change20 / d.ethereum.usd) * 100;
          resolve(d);
        });
      });
    req.on('error', (e) => reject(e))

    req.end();
  });
  return promise
}

async function getTradeFromTransaction(tx) {
  let postData = {
    "id": 1,
    "jsonrpc": "2.0",
    "method": "eth_getLogs",
    "params": [
      {
        "address": [
          POS_VAULT_ADDRESS
        ],
        "fromBlock": "0x4967D9D",
        "toBlock": "latest",
        "topics": [
          "0xe508fdc8bb11e26fd52e43d09c05ba1b7a778fe93ba8a3814b608aa29c3e6cdd",
          "0x000000000000000000000000" + PUBLIC_KEY.substring(2)
        ]
      }
    ]
  };
  const promise = new Promise(function (resolve, reject) {
    let p = "/v2/" + ALC_KEY;
    let options = {
      protocol: 'https:',
      hostname: 'arb-mainnet.g.alchemy.com',
      path: p,
      headers: {
        "Content-Type": "application/json"
      }

    };
    options["method"] = "POST";
    options.headers['Content-Length'] = JSON.stringify(postData).length;


    let req = https.request(
      options, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error('statusCode=' + res.statusCode));
        }

        let response;
        let body = '';
        //console.log("headers: ", res.rawHeaders);
        if (res.headers["link"]) {
          linkUrl = res.headers["link"];
        }

        if (res.headers['content-encoding'] === 'gzip') {
          response = res.pipe(zlib.createGunzip());
        } else {
          response = res;
        }

        response.on('data', (chunk) => {
          body += chunk;
        });



        response.on('end', async () => {
          let d = JSON.parse(body);
          var orders = [];
          for (let f of d.result) {
            if (f.transactionHash == tx) {
              let order = web3.eth.abi.decodeLog([
                {
                  "indexed": false,
                  "name": "key",
                  "type": "bytes32"
                },
                {
                  "indexed": true,
                  "name": "account",
                  "type": "address"
                },
                {
                  "indexed": false,
                  "name": "indexToken",
                  "type": "address"
                },
                {
                  "indexed": false,
                  "name": "isLong",
                  "type": "bool"
                },
                {
                  "indexed": false,
                  "name": "posId",
                  "type": "uint256"
                },
                {
                  "indexed": false,
                  "name": "positionType",
                  "type": "uint256"
                },
                {
                  "indexed": false,
                  "name": "orderStatus",
                  "type": "uint8"
                },
                {
                  "indexed": false,
                  "name": "triggerData",
                  "type": "uint256[]"
                }
              ], f.data, [f.topics[1]]);
              let c = await getPositionUpdate(order);

              orders.push(order);

            }

          }

          resolve(orders);
        });
      });
    req.on('error', (e) => reject(e))
    req.write(JSON.stringify(postData));

    req.end();
  });
  return promise
}

async function getOpenTrades() {
  let postData = {
    "id": 1,
    "jsonrpc": "2.0",
    "method": "eth_getLogs",
    "params": [
      {
        "address": [
          POS_VAULT_ADDRESS
        ],
        "fromBlock": "0x4967D9D",
        "toBlock": "latest",
        "topics": [
          "0xe508fdc8bb11e26fd52e43d09c05ba1b7a778fe93ba8a3814b608aa29c3e6cdd",
          "0x000000000000000000000000" + PUBLIC_KEY.substring(2)
        ]
      }
    ]
  };
  const promise = new Promise(function (resolve, reject) {
    let p = "/v2/" + ALC_KEY;
    let options = {
      protocol: 'https:',
      hostname: 'arb-mainnet.g.alchemy.com',
      path: p,
      headers: {
        "Content-Type": "application/json"
      }

    };
    options["method"] = "POST";
    options.headers['Content-Length'] = JSON.stringify(postData).length;


    let req = https.request(
      options, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error('statusCode=' + res.statusCode));
        }
        let response;
        let body = '';
        //console.log("headers: ", res.rawHeaders);
        if (res.headers["link"]) {
          linkUrl = res.headers["link"];
        }

        if (res.headers['content-encoding'] === 'gzip') {
          response = res.pipe(zlib.createGunzip());
        } else {
          response = res;
        }

        response.on('data', (chunk) => {
          body += chunk;
        });

        response.on('end', async () => {
          let d = JSON.parse(body);
          var orders = [];
          for (let f of d.result) {
            let order = web3.eth.abi.decodeLog([
              {
                "indexed": false,
                "name": "key",
                "type": "bytes32"
              },
              {
                "indexed": true,
                "name": "account",
                "type": "address"
              },
              {
                "indexed": false,
                "name": "indexToken",
                "type": "address"
              },
              {
                "indexed": false,
                "name": "isLong",
                "type": "bool"
              },
              {
                "indexed": false,
                "name": "posId",
                "type": "uint256"
              },
              {
                "indexed": false,
                "name": "positionType",
                "type": "uint256"
              },
              {
                "indexed": false,
                "name": "orderStatus",
                "type": "uint8"
              },
              {
                "indexed": false,
                "name": "triggerData",
                "type": "uint256[]"
              }
            ], f.data, [f.topics[1]]);
            let c = await getPositionUpdate(order);
          
            if (c && c['0'].owner != '0x0000000000000000000000000000000000000000') {
              orders.push(order);
            }

          }
         
          resolve(orders);
        });
      });
    req.on('error', (e) => reject(e))
    req.write(JSON.stringify(postData));


    req.end();
  });
  return promise
}


async function closePosition(order, exitPrice, reason, pl, plUsd) {
  let con = await getCon();

  console.log("Closing: ", order.posId);
  let nonce = await web3.eth.getTransactionCount(PUBLIC_KEY, "latest");
  const tx = {
    from: PUBLIC_KEY,
    to: VELA_ADDRESS,
    nonce: nonce,
    gas: 1400000,
    maxPriorityFeePerGas: 0,
    data: contract.methods.decreasePosition(order.indexToken, order.triggerData[3], order.isLong, order.posId).encodeABI()
  };
  let sql = "UPDATE trades SET exitPrice = ?, closedAt = NOW(), closingReason = ?, profitLoss = ?, profitLossUsd = ? WHERE posId = ?";
  await con.execute(sql, [exitPrice, reason, pl, plUsd, order.posId]);
  web3.eth.accounts.signTransaction(tx, PRIVATE_KEY).then(signedTx => {
    web3.eth.sendSignedTransaction(
      signedTx.rawTransaction,
      function (err, hash) {
        if (err) {
          console.log("error: ", err);
        }
        else {
          console.log("transaction: ", hash);


        }
      }
    )
  }).catch(err => {
    console.log("error: ", err);
  })
}

async function openNewPosition(entryPrice, size, collateral, long, reason) {

  let params = [
    web3.utils.toWei('' + entryPrice, 'ether') + "000000000000",
    250,
    web3.utils.toWei('' + collateral, 'ether') + "000000000000",
    web3.utils.toWei('' + size, 'ether') + "000000000000"
  ]
  let nonce = await web3.eth.getTransactionCount(PUBLIC_KEY, "latest");
  const tx = {
    from: PUBLIC_KEY,
    to: VELA_ADDRESS,
    nonce: nonce,
    gas: 6000000,
    maxPriorityFeePerGas: 10000,
    data: contract.methods.newPositionOrder(ETH_ADDRESS, long, 0, params, "0x6BC729641F5E49DC34c8d7836b9BbB4Fd0a87455").encodeABI()
  };


  let signedTx = await web3.eth.accounts.signTransaction(tx, PRIVATE_KEY);
  let transactionTx = "";
  let t = await web3.eth.sendSignedTransaction(
    signedTx.rawTransaction,
    function (err, hash) {
      if (err) {
        console.log("error: ", err);
      }
      else {
        console.log("transaction: ", hash);

        transactionTx = hash;
      }
    }
  );
  console.log("send: ", t, transactionTx);
  var finished = false;
  while (finished == false) {
    try {
      let d = await getTradeFromTransaction(transactionTx);
      if (d.length > 0) {
        let order = d[0];
        let sql = "INSERT INTO trades (entryPrice, `long`, size, collateral, createdAt, posId, openReason) VALUES(?, ?, ?, ?, NOW(), ?, ?)";
        console.log("order: ", order);
        await con.execute(sql, ["" + entryPrice, "" + (long ? 1 : 0), size, collateral, order.posId, reason]);
        console.log("done!");
        finished = true;
      }
    }
    catch (e) {

    }
   
  }
  console.log("all done!");

}
async function tick() {
  let ethData = await getEthPrice();
  let ethPrice = ethData.ethereum.usd;
  let f;
  try {
    f = await getOpenTrades();
  }
  catch (e) {
    console.log("error: ", e);
    return;
  }
  console.log("Eth-Price: ", ethPrice);
  console.log("Orders:\n")
  console.log("Long | Entry Price | Eth Grwoth | Original Position Size | Position Size Now | Growth | Recommended Action | P/L | P/L USD");
  for (let order of f) {
    let entryPrice = web3.utils.fromWei(order.triggerData[0].replace('000000000000', ''));
    let col = web3.utils.fromWei(order.triggerData[2].replace('000000000000', ''));
    let posSize = web3.utils.fromWei(order.triggerData[3].replace('000000000000', ''));
    let posSizeOriginal = posSize / entryPrice;
    let ethGrowth = ((ethPrice - entryPrice) / entryPrice);
    let l = 1;
    if (order.isLong == false) {
      l = -1;
    }
    let posSizeNow = posSizeOriginal * (1 + l * ethGrowth);
    let growth = (posSizeNow - posSizeOriginal) / posSizeOriginal;
    let growthPercent = growth * 100;
    let recommendedAction = "keep";
    let profitLoss = posSizeNow - posSizeOriginal;
    let profitLossUsd = profitLoss * ethPrice;
    if (growthPercent > 2) {
      recommendedAction = "sell";
    }
    else if (growthPercent < -2) {
      recommendedAction = "sell";
    }
    else if (profitLossUsd < -10) {
      recommendedAction = "sell";
    }
    else if (profitLossUsd > 10) {
      recommendedAction = "sell";
    }
    console.log(order.posId, order.isLong, entryPrice, ethGrowth, posSize, posSizeOriginal, posSizeNow, growthPercent, recommendedAction, profitLoss, profitLossUsd);
    if (recommendedAction == "sell") {
      await closePosition(order, ethPrice, "growth: " + growthPercent, profitLoss, profitLossUsd);
      return;
    }
  }
  if (f.length == 0) {
    var long = true;
    var open = false;
    var size = initialSize;
    var collateral = initialCollateral;
    var longIndicating = 0;
    var shortIndicating = 0;
    if (ethData.ethereum.usd_24h_change > 5) {
      longIndicating++;
    }
    else if (ethData.ethereum.usd_24h_change > 3) {
      longIndicating += 3;
    }
    if (ethData.ethereum.usd_24h_change < -5) {
      shortIndicating++;
    }
    else if (ethData.ethereum.usd_24h_change < -3) {
      shortIndicating += 3;
    }
    else if (ethData.ethereum.usd_24h_change < 0) {
      shortIndicating += 1;
    }
    else if (ethData.ethereum.usd_24h_change > 1) {
      longIndicating += 1;
    }
    if (ethData.price5MinAgo > 0) {
      if (ethData.price5MinAgoPercentage > 0.02) {
        longIndicating++;
      }
      else if (ethData.price5MinAgoPercentage > 0.2) {
        longIndicating += 3;
      }
      if (ethData.price5MinAgoPercentage < -0.02) {
        shortIndicating++;
      }
      else if (ethData.price5MinAgoPercentage < 0.2) {
        shortIndicating += 3;
      }
    }
    if (ethData.price20MinAgo > 0) {
      if (ethData.price20MinAgoPercentage > 0.02) {
        longIndicating++;
      }
      else if (ethData.price20MinAgoPercentage > 0.2) {
        longIndicating += 3;
      }
      if (ethData.price20MinAgoPercentage < -0.02) {
        shortIndicating++;
      }
      else if (ethData.price20MinAgoPercentage < 0.2) {
        shortIndicating += 3;
      }
    }
    if (ethData.price20MinAgo > 0 && ethData.price5MinAgo > 0) {
      if (ethData.price20MinAgoPercentage > 0 && ethData.price5MinAgoPercentage > 0) {
        longIndicating += 5;
      }
      if (ethData.price20MinAgoPercentage < 0 && ethData.price5MinAgoPercentage < 0) {
        shortIndicating += 5;
      }
      if (ethData.ethereum.usd_24h_change > 0 && ethData.price20MinAgoPercentage > 0 && ethData.price5MinAgoPercentage > 0) {
        longIndicating += 10;
      }
      if (ethData.ethereum.usd_24h_change < 0 && ethData.price20MinAgoPercentage < 0 && ethData.price5MinAgoPercentage < 0) {
        longIndicating += 10;
      }
    }
    console.log("indicators: ", longIndicating, shortIndicating);
    if (longIndicating > shortIndicating) {
      let d = longIndicating - shortIndicating;
      size = collateral * 10;
      if (d > 3) {
        collateral = 200;
        size = collateral * 20;
      }
      open = true;
      long = true;
    }
    else if (longIndicating < shortIndicating) {
      let d = shortIndicating - longIndicating;
      size = collateral * 10;
      if (d > 3) {
        collateral = 200;
        size = collateral * 20;
      }
      open = true;
      long = false;
    }
    else {
      console.log("too unpredictable");
    }
    if (open) {
      await openNewPosition(ethPrice, size, collateral, long, "indicators: " + longIndicating + " / " + shortIndicating);
    }

  }
}
async function main() {


  while (true) {
    try {
      await tick();
    }
    catch (e) {
      console.log("error: ", e);
    }
    await wait(30000);
  }

}
main().catch(error => {
  console.log("error: ", error);

})