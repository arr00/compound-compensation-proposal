import chai, { expect } from "chai";
import { solidity, MockProvider, deployContract } from "ethereum-waffle";
import { Contract, BigNumber, constants } from "ethers";

import Distributor from "../build/MerkleDistributor.json";
import TestERC20 from "../build/TestERC20.json";
import MerkleRoot from "../merkle-root/daiCompensationMerkleTree.json";
import governorBravoAbi from "../merkle-root/governorBravo.json";
import Comp from "../merkle-root/Comp.json";

chai.use(solidity);

const overrides = {
  gasLimit: 9999999,
};

describe("Compenstion proposal fork simulations post cap deploy", () => {
  const provider = new MockProvider({
    ganacheOptions: {
      fork: process.env.ETH_RPC + "@13096200",
      hardfork: "istanbul",
      mnemonic: "horn horn horn horn horn horn horn horn horn horn horn horn",
      gasLimit: 9999999,
      unlocked_accounts: ["0x7587cAefc8096f5F40ACB83A09Df031a018C66ec"], //Unlock large COMP account
    },
  });

  const compHolder = provider.getSigner(
    "0x7587cAefc8096f5F40ACB83A09Df031a018C66ec"
  );
  const capAddress = "0xc77e871657543748c488b0e7e292bdea659344ba";

  const wallets = provider.getWallets();
  const [wallet0, wallet1] = wallets;

  // Contract definitions
  let dai = new Contract(
    "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    TestERC20.abi,
    wallet0
  );
  let compCompHolder = new Contract(
    "0xc00e94cb662c3520282e6f5717214004a7f26888",
    Comp.abi,
    compHolder
  );
  let governorBravo = new Contract(
    "0xc0Da02939E1441F497fd74F78cE7Decb17B66529",
    governorBravoAbi.abi,
    compHolder
  );
  let merkleDistributor = new Contract(
    "0x0634ca1D878a050eB525ed08852Cc3BaD7f5a1DC",
    Distributor.abi,
    wallet0
  );

  describe("#Full compensation proposal sim", () => {
    it("propose and execute proposal", async () => {
      await compCompHolder.delegate(capAddress);

      const proposeTx = {
        from: compHolder._address,
        to: capAddress,
        data: "0xc198f8ba",
        value: 0,
      };

      await compHolder.sendTransaction(proposeTx);
      // await expect(
      //   compHolder.sendTransaction(tx)
      // ).to.emit(governorBravo, "ProposalCreated");
      await advanceBlocks(13140);

      const voteTx = {
        from: compHolder._address,
        to: capAddress,
        data: "0x632a9a52",
        value: 0,
      };

      await compHolder.sendTransaction(voteTx);
      await advanceBlocks(19710);

      // Queue
      await expect(governorBravo.queue(59)).to.emit(
        governorBravo,
        "ProposalQueued"
      );
      await advanceTime(259200);

      // Execute
      await expect(governorBravo.execute(59)).to.emit(
        governorBravo,
        "ProposalExecuted"
      );
    }).timeout(60000);

    it("Distributor state is correct", async () => {
      expect(await merkleDistributor.token()).to.eq(dai.address);
      expect(await merkleDistributor.isFunded()).to.eq(true);
      expect(await dai.balanceOf(merkleDistributor.address)).to.eq(
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
        const balanceBefore = await dai.balanceOf(address);

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
        expect(await dai.balanceOf(address)).to.eq(
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
