import { program } from 'commander'
import fs from 'fs'
import { parseBalanceMap } from '../src/parse-balance-map'
import prettier from 'prettier'

const json = JSON.parse(fs.readFileSync('merkle-root/addressBalances.json', { encoding: 'utf8' }))

if (typeof json !== 'object') throw new Error('Invalid JSON')

let contentToWrite = prettier.format(JSON.stringify(parseBalanceMap(json)), {
    parser: "json5",
  });
fs.writeFileSync('merkle-root/daiCompensationMerkleTree.json', contentToWrite);

