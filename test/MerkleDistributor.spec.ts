import chai, { expect } from 'chai'
import { solidity, MockProvider, deployContract } from 'ethereum-waffle'
import { Contract, BigNumber, constants } from 'ethers'
import BalanceTree from '../src/balance-tree'

import Distributor from '../build/MerkleDistributor.json'
import TestERC20 from '../build/TestERC20.json'
import { parseBalanceMap } from '../src/parse-balance-map'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999,
}

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'
const NULL_ADDRESS = '0x0000000000000000000000000000000000000000'

describe('MerkleDistributor', () => {
  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999,
    },
  })

  const wallets = provider.getWallets()
  const [wallet0, wallet1] = wallets

  let token: Contract
  beforeEach('deploy token', async () => {
    token = await deployContract(wallet0, TestERC20, ['Token', 'TKN', 0], overrides)
  })

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
  })

  describe('#merkleRoot', () => {
    it('returns the zero merkle root', async () => {
      const distributor = await deployContract(
        wallet0,
        Distributor,
        [token.address, ZERO_BYTES32, NULL_ADDRESS, ZERO_BYTES32],
        overrides
      )
      expect(await distributor.merkleRoot()).to.eq(ZERO_BYTES32)
    })
  })

  describe('#funder', () => {
    it('returns the funder address', async () => {
      const distributor = await deployContract(
        wallet0,
        Distributor,
        [token.address, ZERO_BYTES32, wallet0.address, ZERO_BYTES32],
        overrides
      )
      expect(await distributor.funder()).to.eq(wallet0.address)
    })
  })

  describe('#fundingAmount', () => {
    it('returns the funding amount', async () => {
      const distributor = await deployContract(
        wallet0,
        Distributor,
        [token.address, ZERO_BYTES32, wallet0.address, 9000],
        overrides
      )
      expect(await distributor.fundingAmount()).to.eq(9000)
    })
  })

  describe('#claim', () => {
    it('fails for empty proof', async () => {
      const distributor = await deployContract(
        wallet0,
        Distributor,
        [token.address, ZERO_BYTES32, NULL_ADDRESS, ZERO_BYTES32],
        overrides
      )
      await expect(distributor.claim(0, wallet0.address, 10, [])).to.be.revertedWith(
        'MerkleDistributor: Invalid proof.'
      )
    })

    it('fails for invalid index', async () => {
      const distributor = await deployContract(
        wallet0,
        Distributor,
        [token.address, ZERO_BYTES32, NULL_ADDRESS, ZERO_BYTES32],
        overrides
      )
      await expect(distributor.claim(0, wallet0.address, 10, [])).to.be.revertedWith(
        'MerkleDistributor: Invalid proof.'
      )
    })

    describe('two account tree', () => {
      let distributor: Contract
      let tree: BalanceTree
      beforeEach('deploy', async () => {
        tree = new BalanceTree([
          { account: wallet0.address, amount: BigNumber.from(100) },
          { account: wallet1.address, amount: BigNumber.from(101) },
        ])
        distributor = await deployContract(
          wallet0,
          Distributor,
          [token.address, tree.getHexRoot(), wallet0.address, 201],
          overrides
        )
        await token.setBalance(wallet0.address, 201)
      })

      it('cannot claim before it is funded', async () => {
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100))
        await expect(distributor.claim(0, wallet0.address, 100, proof0, overrides)).to.be.revertedWith(
          'ERC20: transfer amount exceeds balance'
        )
        const proof1 = tree.getProof(1, wallet1.address, BigNumber.from(101))
        await expect(distributor.claim(1, wallet1.address, 101, proof1, overrides)).to.be.revertedWith(
          'ERC20: transfer amount exceeds balance'
        )
      })

      it('cannot be funded without sufficient approval from funder', async () => {
        await expect(distributor.fund()).to.be.revertedWith('ERC20: transfer amount exceeds allowance')
      })

      it('cannot be funded without sufficient balance of funder', async () => {
        await token.approve(distributor.address, 201)
        await token.setBalance(wallet0.address, 200)
        await expect(distributor.fund()).to.be.revertedWith('ERC20: transfer amount exceeds balance')
      })

      it('#fund with sufficient approval and balance from funder', async () => {
        await token.approve(distributor.address, 201)
        await expect(distributor.fund()).to.emit(distributor, 'Funded').withArgs(wallet0.address, 201)
      })

      it('initially does not set #isFunded', async () => {
        expect(await distributor.isFunded()).to.eq(false)
      })

      it('sets #isFunded after funding', async () => {
        await token.approve(distributor.address, 201)
        await distributor.fund()
        expect(await distributor.isFunded()).to.eq(true)
      })

      it('cannot be funded twice', async () => {
        await token.approve(distributor.address, 402)
        await token.setBalance(wallet0.address, 402)
        await distributor.fund()
        await expect(distributor.fund()).to.be.revertedWith('MerkleDistributor: Distributor has already been funded.')
      })

      it('successful claim', async () => {
        await token.approve(distributor.address, 201)
        await distributor.fund()
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100))
        await expect(distributor.claim(0, wallet0.address, 100, proof0, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(0, wallet0.address, 100)
        const proof1 = tree.getProof(1, wallet1.address, BigNumber.from(101))
        await expect(distributor.claim(1, wallet1.address, 101, proof1, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(1, wallet1.address, 101)
      })

      it('successful claim even with "manual" funding', async () => {
        await token.setBalance(distributor.address, 201)
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100))
        await expect(distributor.claim(0, wallet0.address, 100, proof0, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(0, wallet0.address, 100)
        const proof1 = tree.getProof(1, wallet1.address, BigNumber.from(101))
        await expect(distributor.claim(1, wallet1.address, 101, proof1, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(1, wallet1.address, 101)
      })

      it('transfers the token', async () => {
        await token.approve(distributor.address, 201)
        await distributor.fund()
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100))
        expect(await token.balanceOf(wallet0.address)).to.eq(0)
        await distributor.claim(0, wallet0.address, 100, proof0, overrides)
        expect(await token.balanceOf(wallet0.address)).to.eq(100)
      })

      it('must have enough to transfer', async () => {
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100))
        await token.setBalance(distributor.address, 99)
        await expect(distributor.claim(0, wallet0.address, 100, proof0, overrides)).to.be.revertedWith(
          'ERC20: transfer amount exceeds balance'
        )
      })

      it('sets #isClaimed', async () => {
        await token.approve(distributor.address, 201)
        await distributor.fund()
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100))
        expect(await distributor.isClaimed(0)).to.eq(false)
        expect(await distributor.isClaimed(1)).to.eq(false)
        await distributor.claim(0, wallet0.address, 100, proof0, overrides)
        expect(await distributor.isClaimed(0)).to.eq(true)
        expect(await distributor.isClaimed(1)).to.eq(false)
      })

      it('cannot allow two claims', async () => {
        await token.approve(distributor.address, 201)
        await distributor.fund()
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100))
        await distributor.claim(0, wallet0.address, 100, proof0, overrides)
        await expect(distributor.claim(0, wallet0.address, 100, proof0, overrides)).to.be.revertedWith(
          'MerkleDistributor: Drop already claimed.'
        )
      })

      it('cannot claim more than once: 0 and then 1', async () => {
        await token.approve(distributor.address, 201)
        await distributor.fund()
        await distributor.claim(
          0,
          wallet0.address,
          100,
          tree.getProof(0, wallet0.address, BigNumber.from(100)),
          overrides
        )
        await distributor.claim(
          1,
          wallet1.address,
          101,
          tree.getProof(1, wallet1.address, BigNumber.from(101)),
          overrides
        )

        await expect(
          distributor.claim(0, wallet0.address, 100, tree.getProof(0, wallet0.address, BigNumber.from(100)), overrides)
        ).to.be.revertedWith('MerkleDistributor: Drop already claimed.')
      })

      it('cannot claim more than once: 1 and then 0', async () => {
        await token.approve(distributor.address, 201)
        await distributor.fund()
        await distributor.claim(
          1,
          wallet1.address,
          101,
          tree.getProof(1, wallet1.address, BigNumber.from(101)),
          overrides
        )
        await distributor.claim(
          0,
          wallet0.address,
          100,
          tree.getProof(0, wallet0.address, BigNumber.from(100)),
          overrides
        )

        await expect(
          distributor.claim(1, wallet1.address, 101, tree.getProof(1, wallet1.address, BigNumber.from(101)), overrides)
        ).to.be.revertedWith('MerkleDistributor: Drop already claimed.')
      })

      it('cannot claim for address other than proof', async () => {
        await token.approve(distributor.address, 201)
        await distributor.fund()
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100))
        await expect(distributor.claim(1, wallet1.address, 101, proof0, overrides)).to.be.revertedWith(
          'MerkleDistributor: Invalid proof.'
        )
      })

      it('cannot claim more than proof', async () => {
        await token.approve(distributor.address, 201)
        await distributor.fund()
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100))
        await expect(distributor.claim(0, wallet0.address, 101, proof0, overrides)).to.be.revertedWith(
          'MerkleDistributor: Invalid proof.'
        )
      })

      it('gas', async () => {
        await token.approve(distributor.address, 201)
        await distributor.fund()
        const proof = tree.getProof(0, wallet0.address, BigNumber.from(100))
        const tx = await distributor.claim(0, wallet0.address, 100, proof, overrides)
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(78466 + 64) // Note: more expensive due to extra functions in dispatcher
      })
    })
    describe('larger tree', () => {
      let distributor: Contract
      let tree: BalanceTree
      beforeEach('deploy', async () => {
        tree = new BalanceTree(
          wallets.map((wallet, ix) => {
            return { account: wallet.address, amount: BigNumber.from(ix + 1) }
          })
        )
        distributor = await deployContract(
          wallet0,
          Distributor,
          [token.address, tree.getHexRoot(), NULL_ADDRESS, ZERO_BYTES32],
          overrides
        )
        await token.setBalance(distributor.address, 201)
      })

      it('claim index 4', async () => {
        const proof = tree.getProof(4, wallets[4].address, BigNumber.from(5))
        await expect(distributor.claim(4, wallets[4].address, 5, proof, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(4, wallets[4].address, 5)
      })

      it('claim index 9', async () => {
        const proof = tree.getProof(9, wallets[9].address, BigNumber.from(10))
        await expect(distributor.claim(9, wallets[9].address, 10, proof, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(9, wallets[9].address, 10)
      })

      it('gas', async () => {
        const proof = tree.getProof(9, wallets[9].address, BigNumber.from(10))
        const tx = await distributor.claim(9, wallets[9].address, 10, proof, overrides)
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(80960 + 64) // Note: more expensive due to extra functions in dispatcher
      })

      it('gas second down about 15k', async () => {
        await distributor.claim(
          0,
          wallets[0].address,
          1,
          tree.getProof(0, wallets[0].address, BigNumber.from(1)),
          overrides
        )
        const tx = await distributor.claim(
          1,
          wallets[1].address,
          2,
          tree.getProof(1, wallets[1].address, BigNumber.from(2)),
          overrides
        )
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(65940 + 64) // Note: more expensive due to extra functions in dispatcher
      })
    })

    describe('realistic size tree', () => {
      let distributor: Contract
      let tree: BalanceTree
      const NUM_LEAVES = 100_000
      const NUM_SAMPLES = 25
      const elements: { account: string; amount: BigNumber }[] = []
      for (let i = 0; i < NUM_LEAVES; i++) {
        const node = { account: wallet0.address, amount: BigNumber.from(100) }
        elements.push(node)
      }
      tree = new BalanceTree(elements)

      it('proof verification works', () => {
        const root = Buffer.from(tree.getHexRoot().slice(2), 'hex')
        for (let i = 0; i < NUM_LEAVES; i += NUM_LEAVES / NUM_SAMPLES) {
          const proof = tree
            .getProof(i, wallet0.address, BigNumber.from(100))
            .map((el) => Buffer.from(el.slice(2), 'hex'))
          const validProof = BalanceTree.verifyProof(i, wallet0.address, BigNumber.from(100), proof, root)
          expect(validProof).to.be.true
        }
      })

      beforeEach('deploy', async () => {
        distributor = await deployContract(
          wallet0,
          Distributor,
          [token.address, tree.getHexRoot(), NULL_ADDRESS, ZERO_BYTES32],
          overrides
        )
        await token.setBalance(distributor.address, constants.MaxUint256)
      })

      it('gas', async () => {
        const proof = tree.getProof(50000, wallet0.address, BigNumber.from(100))
        const tx = await distributor.claim(50000, wallet0.address, 100, proof, overrides)
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(91650 + 64) // Note: more expensive due to extra functions in dispatcher
      })
      it('gas deeper node', async () => {
        const proof = tree.getProof(90000, wallet0.address, BigNumber.from(100))
        const tx = await distributor.claim(90000, wallet0.address, 100, proof, overrides)
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(91586 + 64) // Note: more expensive due to extra functions in dispatcher
      })
      it('gas average random distribution', async () => {
        let total: BigNumber = BigNumber.from(0)
        let count: number = 0
        for (let i = 0; i < NUM_LEAVES; i += NUM_LEAVES / NUM_SAMPLES) {
          const proof = tree.getProof(i, wallet0.address, BigNumber.from(100))
          const tx = await distributor.claim(i, wallet0.address, 100, proof, overrides)
          const receipt = await tx.wait()
          total = total.add(receipt.gasUsed)
          count++
        }
        const average = total.div(count)
        expect(average).to.eq(77075 + 64) // Note: more expensive due to extra functions in dispatcher
      })
      // this is what we gas golfed by packing the bitmap
      it('gas average first 25', async () => {
        let total: BigNumber = BigNumber.from(0)
        let count: number = 0
        for (let i = 0; i < 25; i++) {
          const proof = tree.getProof(i, wallet0.address, BigNumber.from(100))
          const tx = await distributor.claim(i, wallet0.address, 100, proof, overrides)
          const receipt = await tx.wait()
          total = total.add(receipt.gasUsed)
          count++
        }
        const average = total.div(count)
        expect(average).to.eq(62824 + 64) // Note: more expensive due to extra functions in dispatcher
      })

      it('no double claims in random distribution', async () => {
        for (let i = 0; i < 25; i += Math.floor(Math.random() * (NUM_LEAVES / NUM_SAMPLES))) {
          const proof = tree.getProof(i, wallet0.address, BigNumber.from(100))
          await distributor.claim(i, wallet0.address, 100, proof, overrides)
          await expect(distributor.claim(i, wallet0.address, 100, proof, overrides)).to.be.revertedWith(
            'MerkleDistributor: Drop already claimed.'
          )
        }
      })
    })

    describe('real tree', () => {
      let distributor:Contract

      beforeEach('deploy', async () => {
        distributor = await deployContract(
          wallet0,
          Distributor,
          [token.address,"0x8fa942fc1388ecfe2edc5ec5b700c124eff18779d543319147ec172cbc923338", wallet0.address, "68177979610616261448680"],
          overrides
        )
        await token.setBalance(wallet0.address, "68177979610616261448680")
        await token.approve(distributor.address, "68177979610616261448680")
        await distributor.fund()
      })

      it('run random claim', async () => {
        await distributor.claim(0, "0x0060f3570331bF192682AfC1aABEE27aF2Ce8e3d", "0x1535a09d245726e9", [
        "0x4c3fc3e1d1e1fe9f0a70337f4d5dcd75521cdbe7262cd88eef3664a7ea55287f",
        "0x5287fa44e50f39bdb031b7acf0d5836ad2f792dac79b0be422480b8f218dd8c2",
        "0xea5cd59bc83b1516dad3a027accacf400f1bfdae77c17bd7dcfcd61b5fcda11a",
        "0xf7cfa72b306462e1ed4ab4163092c3f9495d6b3c71cd3eb7ec1c6bd05e753389",
        "0xca302f4ac80174e30ad74a6f855854ae1bd309cb5879a07543c5d2210318f10e",
        "0x7d7bbfa6ffd1511f97780df4ce6dccee9be5524ae7009a1693c899aa60245ee0",
        "0x3d0b4bd7e9e8faf49ec2dc2119838917d8b19dc819d0d128c3cdb029891dbef8"
      ], overrides)
        expect(await token.balanceOf("0x0060f3570331bF192682AfC1aABEE27aF2Ce8e3d")).to.eq("0x1535a09d245726e9")
      })

      it('run random claim 2', async () => {
        await distributor.claim(116, "0xe4C3b87DfB2c95c61384f9f5345e462912A735D1", "0x101d7bb5884a9a84", [
        "0xa1842f65fdb91f7cf001c6f0c497f9fd1c91e4fbb7a0b7905e7ad5c02b7c3c1a",
        "0xe2c26b563d044e176708ae15d646114b5aef489462b47ab2c67fbf75e700ab54",
        "0x22762865a47bff2a7c33e51596f40f5bd8c5c3a5bf48cb516a41a9ad2d73fe46",
        "0xcd40238e2867b9c0dd04a289c4741b219679a053839765de97bdf74f6da3fd42",
        "0x0a0f0602cf50e9dc6db7bed0e737d1b37f044d44e130a8b2a208d237217317ba",
        "0xa2dc89b1e1907402127b599b70472f5c757722acf0046086f10bcbe46c76f44e",
        "0x80843a9f35298802a5eb9cddd397c05b07411200b9045100e49d2811ca707962"
      ], overrides)
        expect(await token.balanceOf("0xe4C3b87DfB2c95c61384f9f5345e462912A735D1")).to.eq("0x101d7bb5884a9a84")
      })
    })
  })

  describe('parseBalanceMap', () => {
    let distributor: Contract
    let claims: {
      [account: string]: {
        index: number
        amount: string
        proof: string[]
      }
    }
    beforeEach('deploy', async () => {
      const { claims: innerClaims, merkleRoot, tokenTotal } = parseBalanceMap({
        [wallet0.address]: 200,
        [wallet1.address]: 300,
        [wallets[2].address]: 250,
      })
      expect(tokenTotal).to.eq('0x02ee') // 750
      claims = innerClaims
      distributor = await deployContract(
        wallet0,
        Distributor,
        [token.address, merkleRoot, NULL_ADDRESS, ZERO_BYTES32],
        overrides
      )
      await token.setBalance(distributor.address, tokenTotal)
    })

    it('check the proofs is as expected', () => {
      expect(claims).to.deep.eq({
        [wallet0.address]: {
          index: 0,
          amount: '0xc8',
          proof: ['0x2a411ed78501edb696adca9e41e78d8256b61cfac45612fa0434d7cf87d916c6'],
        },
        [wallet1.address]: {
          index: 1,
          amount: '0x012c',
          proof: [
            '0xbfeb956a3b705056020a3b64c540bff700c0f6c96c55c0a5fcab57124cb36f7b',
            '0xd31de46890d4a77baeebddbd77bf73b5c626397b73ee8c69b51efe4c9a5a72fa',
          ],
        },
        [wallets[2].address]: {
          index: 2,
          amount: '0xfa',
          proof: [
            '0xceaacce7533111e902cc548e961d77b23a4d8cd073c6b68ccf55c62bd47fc36b',
            '0xd31de46890d4a77baeebddbd77bf73b5c626397b73ee8c69b51efe4c9a5a72fa',
          ],
        },
      })
    })

    it('all claims work exactly once', async () => {
      for (let account in claims) {
        const claim = claims[account]
        await expect(distributor.claim(claim.index, account, claim.amount, claim.proof, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(claim.index, account, claim.amount)
        await expect(distributor.claim(claim.index, account, claim.amount, claim.proof, overrides)).to.be.revertedWith(
          'MerkleDistributor: Drop already claimed.'
        )
      }
      expect(await token.balanceOf(distributor.address)).to.eq(0)
    })
  })
})
