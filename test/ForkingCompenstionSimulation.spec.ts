import chai, { expect } from 'chai'
import { solidity, MockProvider, deployContract } from 'ethereum-waffle'
import { Contract, BigNumber, constants } from 'ethers'
import BalanceTree from '../src/balance-tree'


import Distributor from '../build/MerkleDistributor.json'
import TestERC20 from '../build/TestERC20.json'
import MerkleRoot from '../merkle-root/daiCompensationMerkleTree.json'
import governorBravoAbi from '../merkle-root/governorBravo.json'
import { parseBalanceMap } from '../src/parse-balance-map'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999,
}

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'
const NULL_ADDRESS = '0x0000000000000000000000000000000000000000'

describe('ForkingCompensationSimulation', () => {
  const provider = new MockProvider({
    ganacheOptions: {
      fork: process.env.ETH_RPC + '@12910876',
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999,
      unlocked_accounts: ['0xd5447a7aa223268398cf7c38c2c580622cc98772','0x6626593C237f530D15aE9980A95ef938Ac15c35c'],
    },
  })

  const compHolder = provider.getSigner('0xd5447a7aa223268398cf7c38c2c580622cc98772');
  const compHolder2 = provider.getSigner('0x6626593C237f530D15aE9980A95ef938Ac15c35c');

  const timelock = '0x6d903f6003cca6255D85CcA4D3B5E5146dC33925';
  const wallets = provider.getWallets()
  const [wallet0, wallet1] = wallets

  let token = new Contract('0x6B175474E89094C44Da98b954EedeAC495271d0F',TestERC20.abi,wallet0);
  let governorBravo = new Contract('0xc0Da02939E1441F497fd74F78cE7Decb17B66529', governorBravoAbi.abi, compHolder);
  let governorBravoCompHolder2 = new Contract('0xc0Da02939E1441F497fd74F78cE7Decb17B66529', governorBravoAbi.abi, compHolder2);
  let merkleDistributor:Contract;

    describe('#sanity test Distributor', () => {
    let token: Contract
    beforeEach('deploy token', async () => {
      token = await deployContract(wallet0, TestERC20, ['Token', 'TKN', 0], overrides)
    })

    it('claim still works', async () => {
      merkleDistributor = await deployContract(
        wallet0,
        Distributor,
        [token.address, MerkleRoot.merkleRoot, wallet0.address, BigInt("0x0848f2bd62320b332b")],
        overrides
      )

      await token.setBalance(wallet0.address, BigInt("0x0848f2bd62320b332b"))
      expect(await token.balanceOf(wallet0.address)).to.eq(BigInt("0x0848f2bd62320b332b"))
      await token.approve(merkleDistributor.address, BigInt("0x0848f2bd62320b332b"))
      await expect(merkleDistributor.fund(overrides)).to.emit(merkleDistributor,"Funded");

      await merkleDistributor.claim(0, "0x0060f3570331bF192682AfC1aABEE27aF2Ce8e3d", BigInt("0x0848f2bd62320b332b"), [
        "0xa0379667854def5baf0df2b3bb2d0a1aaf6bcfc93a9a7621d63c5b1c097098af",
        "0xcc90c0b91f6b71af52a99501702316538b5c7c9b49818318602727a8a9049a6b",
        "0xf525e098fbde0a942042bcc3308b3d95a11a6e350bf71bdb9ee4d5cbe6651c9b",
        "0x22a42e01dcb86b8c16cbfe0eb9f92e7941b99a9057c2179f99940d62fe4ca314",
        "0xb23906aad335aa9cb4bf3158f7c5c5b0e58066c717c521db418e78b969247b91",
        "0xfddc7a1aa663c4ff4c9bf2228eec04cba6fb1aa92f8d5bcf61e379d326e6a3b4",
        "0xb3c9115c2b9d561809e39c484f461dc5367925452f0f800facc289b747c2eaff"
      ], overrides)
      expect(await token.balanceOf("0x0060f3570331bF192682AfC1aABEE27aF2Ce8e3d")).to.eq(BigInt("0x0848f2bd62320b332b"))
    })
  })

  describe('#test proposal', () => {
    beforeEach('propose and execute proposal', async () => {
      merkleDistributor = await deployContract(
        wallet0,
        Distributor,
        [token.address, MerkleRoot.merkleRoot, timelock, MerkleRoot.tokenTotal],
        overrides
      )
      const merkleAddressTrimmed = merkleDistributor.address.substring(2);
      await expect(governorBravo.propose(['0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643','0x6B175474E89094C44Da98b954EedeAC495271d0F', merkleDistributor.address],[0, 0, 0],['_reduceReserves(uint256)', 'approve(address,uint256)', 'fund()'],['0x00000000000000000000000000000000000000000005a3b9916b8fd26693deba','0x000000000000000000000000' +  merkleAddressTrimmed + '00000000000000000000000000000000000000000005a3b9916b8fd26693deba', '0x00'],'Compensation Proposal')).to.emit(governorBravo, 'ProposalCreated');
      await advanceBlocks(13140);
      await expect(governorBravo.castVote(54,1)).to.emit(governorBravo,"VoteCast");
      await expect(governorBravoCompHolder2.castVote(54,1)).to.emit(governorBravo,"VoteCast");
      await advanceBlocks(19710);
      await expect(governorBravo.queue(54)).to.emit(governorBravo,"ProposalQueued");
      await advanceTime(259200);
      await governorBravo.execute(54);
      expect(await token.balanceOf(merkleDistributor.address)).to.eq(BigInt("6817797961061626144874170"))
      console.log('Finished with proposal');

    })
    it('recognize token', async () => {
      expect(await merkleDistributor.token()).to.eq(token.address)
      expect(await merkleDistributor.isFunded()).to.eq(true)
      const merkleDist2 = new Contract(merkleDistributor.address, Distributor.abi, compHolder)

      await merkleDist2.claim(0, "0x0060f3570331bF192682AfC1aABEE27aF2Ce8e3d", BigInt("0x0848f2bd62320b332b"), [
        "0xa0379667854def5baf0df2b3bb2d0a1aaf6bcfc93a9a7621d63c5b1c097098af",
        "0xcc90c0b91f6b71af52a99501702316538b5c7c9b49818318602727a8a9049a6b",
        "0xf525e098fbde0a942042bcc3308b3d95a11a6e350bf71bdb9ee4d5cbe6651c9b",
        "0x22a42e01dcb86b8c16cbfe0eb9f92e7941b99a9057c2179f99940d62fe4ca314",
        "0xb23906aad335aa9cb4bf3158f7c5c5b0e58066c717c521db418e78b969247b91",
        "0xfddc7a1aa663c4ff4c9bf2228eec04cba6fb1aa92f8d5bcf61e379d326e6a3b4",
        "0xb3c9115c2b9d561809e39c484f461dc5367925452f0f800facc289b747c2eaff"
      ], overrides)

      expect(await token.balanceOf("0x0060f3570331bF192682AfC1aABEE27aF2Ce8e3d")).to.eq(BigInt("0x0848f2bd62320b332b"))
    })
  })

  async function advanceTime(seconds:number) {
    await provider.send("evm_increaseTime", [seconds])
    await provider.send("evm_mine", []);
  }
  async function advanceBlocks(blocks:number) {
    let currentBlock = await provider.getBlockNumber()
    await provider.send("evm_mineBlockNumber",[blocks + currentBlock])
  }
})


