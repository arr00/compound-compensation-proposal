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

  beforeEach('deploy merkleDistributor', async () => {
    merkleDistributor = await deployContract(
        wallet0,
        Distributor,
        [token.address, MerkleRoot.merkleRoot, timelock, MerkleRoot.tokenTotal],
        overrides
      )
  });

  describe('#token', () => {
    it('returns the token address', async () => {
      const distributor = await deployContract(
        wallet0,
        Distributor,
        [token.address, ZERO_BYTES32, NULL_ADDRESS, ZERO_BYTES32],
        overrides
      )
      expect(await distributor.token()).to.eq(token.address)
    })
  });

  describe('#test proposal', () => {
    it('propose', async () => {
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
