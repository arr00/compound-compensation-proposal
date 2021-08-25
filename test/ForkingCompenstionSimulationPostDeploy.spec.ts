import chai, { expect } from "chai";
import { solidity, MockProvider, deployContract } from "ethereum-waffle";
import { Contract, BigNumber, constants } from "ethers";

import Distributor from "../build/MerkleDistributor.json";
import TestERC20 from "../build/TestERC20.json";
import MerkleRoot from "../merkle-root/daiCompensationMerkleTree.json";
import governorBravoAbi from "../merkle-root/governorBravo.json";

chai.use(solidity);

const overrides = {
  gasLimit: 9999999,
};

describe("Compenstion proposal fork simulations post deploy", () => {
  const provider = new MockProvider({
    ganacheOptions: {
      fork: process.env.ETH_RPC + "@13093037",
      hardfork: "istanbul",
      mnemonic: "horn horn horn horn horn horn horn horn horn horn horn horn",
      gasLimit: 9999999,
      unlocked_accounts: [
        "0xd5447a7aa223268398cf7c38c2c580622cc98772",
        "0x6626593C237f530D15aE9980A95ef938Ac15c35c",
      ], //Unlock large COMP accounts
    },
  });

  const compHolder = provider.getSigner(
    "0xd5447a7aa223268398cf7c38c2c580622cc98772"
  );
  const compHolder2 = provider.getSigner(
    "0x6626593c237f530d15ae9980a95ef938ac15c35c"
  );
  const timelock = "0x6d903f6003cca6255D85CcA4D3B5E5146dC33925";

  const wallets = provider.getWallets();
  const [wallet0, wallet1] = wallets;

  // Contract definitions
  let token = new Contract(
    "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    TestERC20.abi,
    wallet0
  );
  let governorBravo = new Contract(
    "0xc0Da02939E1441F497fd74F78cE7Decb17B66529",
    governorBravoAbi.abi,
    compHolder
  );
  let governorBravoCompHolder2 = new Contract(
    "0xc0Da02939E1441F497fd74F78cE7Decb17B66529",
    governorBravoAbi.abi,
    compHolder2
  );
  let merkleDistributor = new Contract(
    "0x0634ca1D878a050eB525ed08852Cc3BaD7f5a1DC",
    Distributor.abi,
    wallet0
  );

  describe("#Full compensation proposal sim", () => {
    it("propose and execute proposal", async () => {
      // Propose
      const merkleAddressTrimmed = merkleDistributor.address.substring(2);
      await expect(
        governorBravo.propose(
          [
            "0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643",
            "0x6B175474E89094C44Da98b954EedeAC495271d0F",
            merkleDistributor.address,
          ],
          [0, 0, 0],
          ["_reduceReserves(uint256)", "approve(address,uint256)", "fund()"],
          [
            "0x00000000000000000000000000000000000000000005a3b9916b8fd26693deba",
            "0x000000000000000000000000" +
              merkleAddressTrimmed +
              "00000000000000000000000000000000000000000005a3b9916b8fd26693deba",
            "0x00",
          ],
          "Compensation Proposal"
        )
      ).to.emit(governorBravo, "ProposalCreated");
      await advanceBlocks(13140);

      // Vote
      await expect(governorBravo.castVote(59, 1)).to.emit(
        governorBravo,
        "VoteCast"
      );
      await expect(governorBravoCompHolder2.castVote(59, 1)).to.emit(
        governorBravo,
        "VoteCast"
      );
      await advanceBlocks(19710);

      // Queue
      await expect(governorBravo.queue(59)).to.emit(
        governorBravo,
        "ProposalQueued"
      );
      await advanceTime(259200);

      // Execute
      await governorBravo.execute(59);
    }).timeout(30000);

    it("Distributor state is correct", async () => {
      expect(await merkleDistributor.token()).to.eq(token.address);
      expect(await merkleDistributor.isFunded()).to.eq(true);
      expect(await token.balanceOf(merkleDistributor.address)).to.eq(
        BigInt("6817797961061626144874170")
      );
    });

    it("Test claiming", async () => {
      // Initiate claim from compHolder address
      const merkleDist2 = new Contract(
        merkleDistributor.address,
        Distributor.abi,
        compHolder
      );

      const claims: Record<string, any> = MerkleRoot.claims;

      // Test claiming for 12 random accounts
      for (var i = 1; i < Object.keys(MerkleRoot.claims).length - 10; i += 10) {
        const address: string = Object.keys(MerkleRoot.claims)[i];
        const currentClaim = claims[address];
        const balanceBefore = await token.balanceOf(address);

        await expect(
          merkleDist2.claim(
            currentClaim.index,
            address,
            currentClaim.amount,
            currentClaim.proof,
            overrides
          )
        ).to.emit(merkleDist2, "Claimed");

        // Address correctly recieved claim
        expect(await token.balanceOf(address)).to.eq(
          BigInt(balanceBefore) + BigInt(currentClaim.amount)
        );
      }
    });
  });

  async function advanceTime(seconds: number) {
    await provider.send("evm_increaseTime", [seconds]);
    await provider.send("evm_mine", []);
  }
  async function advanceBlocks(blocks: number) {
    let currentBlock = await provider.getBlockNumber();
    await provider.send("evm_mineBlockNumber", [blocks + currentBlock]);
  }
});
