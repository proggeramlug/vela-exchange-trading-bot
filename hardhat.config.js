require('dotenv').config()
const { 
  PRIVATE_KEY,
  ARB_API_URL} = process.env;

module.exports = {
  solidity: "0.8.17",
  defaultNetwork: "arbitrumOne",
  networks: {
    hardhat: {},
    arbitrumOne: {
      url: ARB_API_URL,
      accounts: [`0x${PRIVATE_KEY}`],
    },
  }
};