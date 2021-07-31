// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.5.0;

// Allows anyone to claim a token if they exist in a merkle root.
interface IMerkleDistributor {
    // Returns the address of the token distributed by this contract.
    function token() external view returns (address);
    // Returns the merkle root of the merkle tree containing account balances available to claim.
    function merkleRoot() external view returns (bytes32);
    // Returns the address that will fund the merkle distributor.
    function funder() external view returns (address);
    // Returns the token amount that will be provided when funding the merkle distributor.
    function fundingAmount() external view returns (uint256);
    // Returns true if the merkle distributor has been funded, otherwise false.
    function isFunded() external view returns (bool);
    // Returns true if the index has been marked claimed.
    function isClaimed(uint256 index) external view returns (bool);
    // Claim the given amount of the token to the given address. Reverts if the inputs are invalid.
    function claim(uint256 index, address account, uint256 amount, bytes32[] calldata merkleProof) external;
    // Trigger a transfer of tokens from the funder to the merkle distributor address. Reverts if the token transfer fails.
    function fund() external;

    // This event is triggered whenever a call to #claim succeeds.
    event Claimed(uint256 index, address account, uint256 amount);

    // This event is triggered once a call to #fund succeeds.
    event Funded(address account, uint256 amount);
}