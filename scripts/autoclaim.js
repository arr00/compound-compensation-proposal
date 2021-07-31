// Autoclaim generates transactions claiming for each account in the COMP merkle tree

const Web3 = require("web3");
const fs = require("fs");
const merkleTree = JSON.parse(
  fs.readFileSync("merkle-root/compCompensationMerkleTree.json")
);
const claims = merkleTree["claims"];
const distributorAbi = JSON.parse(
  fs.readFileSync("build/MerkleDistributor.json")
)["abi"];
const { program } = require("commander");
const { utils } = require("ethers");
const wssUrl = process.env.WSS_URL;

if (wssUrl == undefined) {
  throw new Error("WSS_URL env must be set");
}

const web3 = new Web3(wssUrl);
const distributorAddress = "0xF8649AC6D88633b381A9537242CAfeF6DC4482d2";

async function relayAll(privateKey) {
  web3.eth.accounts.wallet.add(privateKey);
  const fromWallet = await web3.eth.accounts.wallet[0].address;
  const distributorContract = new web3.eth.Contract(
    distributorAbi,
    distributorAddress,
    { from: fromWallet, gasPrice: 1000000000, gas: 130000 }
  );
  let initNonce = await web3.eth.getTransactionCount(fromWallet);

  for (let account in claims) {
    const index = claims[account]["index"];
    const amount = claims[account]["amount"];
    const proof = claims[account]["proof"];
    const claimed = await distributorContract.methods.isClaimed(index).call();
    if (!claimed) {
      console.log("Claiming for " + account + " index of " + index);
      distributorContract.methods
        .claim(index, account, amount, proof)
        .send({ nonce: initNonce });
      initNonce++;
    }
  }
}

program
  .version("0.1")
  .requiredOption(
    "-w, --wallet <address>",
    "input the wallet private key to relay transactions from"
  );
program.parse(process.argv);
relayAll(program.wallet);
