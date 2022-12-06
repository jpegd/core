import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { getProxyAdminFactory } from "@openzeppelin/hardhat-upgrades/dist/utils";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers, network, upgrades } from "hardhat";
import hre from "hardhat";
import {
  PETHNFTVault,
  ClonexEggAirdropClaim,
  IEgg,
  IERC721,
} from "../types";
import { BigNumber } from "ethers";

const { expect } = chai;

chai.use(solidity);

describe("ClonexEggAirdropClaim", () => {
  let user: SignerWithAddress;
  let clonexVault: PETHNFTVault;
  let claim: ClonexEggAirdropClaim;
  let egg: IEgg;
  let clonex: IERC721;

  beforeEach(async () => {
    const accounts = await ethers.getSigners();
    const owner = accounts[0];

    await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: ["0x73147F1A2EBCf284b2D0061299bdA8608fe0177F"],
    });

    await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: ["0x51C2cEF9efa48e08557A361B52DB34061c025a1B"],
    });

    user = await ethers.getSigner("0x73147F1A2EBCf284b2D0061299bdA8608fe0177F");

    await owner.sendTransaction({ from: owner.address, to: user.address, value: BigNumber.from(1e18.toString()) })

    const multisig = await ethers.getSigner("0x51C2cEF9efa48e08557A361B52DB34061c025a1B");

    clonexVault = <PETHNFTVault>(
      await ethers.getContractAt(
        "PETHNFTVault",
        "0x46db8fda0bE00E8912Bc28357d1E28E39bb404e2",
        owner
      )
    );

    const ProxyAdmin = await getProxyAdminFactory(hre);
    const proxyAdmin = ProxyAdmin.attach("0x4156d093F5e6D649fCDccdBAB733782b726b13d7");

    const PETHNFTVault = await ethers.getContractFactory("PETHNFTVault");
    const newImpl = await PETHNFTVault.deploy();

    await proxyAdmin.connect(multisig).upgrade(clonexVault.address, newImpl.address);

    egg = <IEgg>(await ethers.getContractAt("IEgg", "0x6c410cf0b8c113dc6a7641b431390b11d5515082", owner))
    clonex = <IERC721>(await ethers.getContractAt("IERC721", "0x49cF6f5d44E70224e2E23fDcdd2C053F30aDA28B", owner))

    const AirdropClaim = await ethers.getContractFactory("ClonexEggAirdropClaim");
    claim = await AirdropClaim.deploy();

    await claim.transferOwnership(clonexVault.address);

    await clonexVault.connect(multisig).addStrategy(claim.address);
  });

  it("should allow users to claim Egg NFTs", async () => {
    await clonexVault.connect(user).depositInStrategy([2817, 17306], 0, "0x")
    expect(await clonex.ownerOf(2817)).to.equal(clonexVault.address);
    expect(await clonex.ownerOf(17306)).to.equal(clonexVault.address);


    expect(await egg.balanceOf(user.address)).to.equal(2);
  });
});