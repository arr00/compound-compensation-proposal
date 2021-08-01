const Web3 = require("web3");
const fs = require("fs");
const prettier = require("prettier");

const web3Url = process.env.ETH_RPC;
const web3 = new Web3(web3Url);
const daiAbi = JSON.parse(fs.readFileSync("scripts/cDAI.abi"));
const cDAI = new web3.eth.Contract(
  daiAbi,
  "0x5d3a536e4d6dbd6114cc1ead35777bab948e3643"
);

const FROM_BLOCK = 11332733;
const TO_BLOCK = 11335286;

async function getLiquidatedAddresses() {
  let effectedAddresses = {};
  let totalDaiToCompensate = 0n;
  await cDAI.getPastEvents(
    "LiquidateBorrow",
    { fromBlock: FROM_BLOCK, toBlock: TO_BLOCK },
    function (error, events) {
      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        if (event != null && event != undefined) {
          totalDaiToCompensate =
            totalDaiToCompensate +
            (BigInt(event["returnValues"]["repayAmount"]) * 8n) / 100n;
          if (
            effectedAddresses[event["returnValues"]["borrower"]] == undefined
          ) {
            effectedAddresses[event["returnValues"]["borrower"]] =
              (BigInt(event["returnValues"]["repayAmount"]) * 8n) / 100n;
          } else {
            effectedAddresses[event["returnValues"]["borrower"]] =
              (BigInt(event["returnValues"]["repayAmount"]) * 8n) / 100n +
              effectedAddresses[event["returnValues"]["borrower"]];
          }
        }
      }
    }
  );
  return [effectedAddresses, totalDaiToCompensate];
}

async function getDaiCompensationBalances() {
  let effectedAddresses;
  let totalDaiToCompensate;

  console.log("getting addresses");

  [effectedAddresses, totalDaiToCompensate] = await getLiquidatedAddresses();
  let daiToCompensate = {};

  for (let add in effectedAddresses) {
    daiToCompensate[add] = effectedAddresses[add].toString(16);
  }

  let contentToWrite = prettier.format(JSON.stringify(daiToCompensate), {
    parser: "json",
  });
  fs.writeFileSync(
    "merkle-root/addressBalances.json",
    contentToWrite
  );
  console.log(
    "Address balances succesfully written to generateAddressBalances/addressBalances.json"
  );
  process.exit();
}

getDaiCompensationBalances();
