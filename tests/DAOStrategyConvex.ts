import { JsonRpcSigner } from "@ethersproject/providers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers, network, upgrades } from "hardhat";
import {
	IBaseRewardPool,
	IBooster,
	ICurve,
	IERC20,
	DAOStrategyConvex,
	JPEGIndexStaking,
	JPEGIndex,
} from "../types";
import { timeTravel, units } from "./utils";

const { expect } = chai;

chai.use(solidity);

const strategist_role = "0x17a8e30262c1f919c33056d877a3c22b95c2f5e4dac44683c1c2323cd79fbdb0";
const minter_role = "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6";

//this is the only contract that requires mainnet forking to test,
//unfortunately we can't use hardhat_reset as that breaks solidity-coverage
describe("DAOStrategyConvex", () => {
	let owner: JsonRpcSigner;
	let strategy: DAOStrategyConvex, staking: JPEGIndexStaking;
	let booster: IBooster;
	let want: ICurve,
		cvx: IERC20,
		crv: IERC20;
	let cvxSigner: JsonRpcSigner,
		crvSigner: JsonRpcSigner;
	let rewardPool: IBaseRewardPool;
	let jpegIndex: JPEGIndex;
	let snapshot: string;

	beforeEach(async () => {
		await network.provider.request({
			method: "hardhat_impersonateAccount",
			params: ["0x51C2cEF9efa48e08557A361B52DB34061c025a1B"],
		});

		owner = ethers.provider.getSigner("0x51C2cEF9efa48e08557A361B52DB34061c025a1B");

		snapshot = (await network.provider.request({
			method: "evm_snapshot",
			params: [],
		})) as string;

		cvx = <IERC20>(
			await ethers.getContractAt(
				"IERC20",
				"0x4e3fbd56cd56c3e72c1403e103b45db9da5b9d2b",
				owner
			)
		);
		crv = <IERC20>(
			await ethers.getContractAt(
				"IERC20",
				"0xD533a949740bb3306d119CC777fa900bA034cd52",
				owner
			)
		);

		want = <ICurve>(
			await ethers.getContractAt(
				"ICurve",
				"0x9848482da3Ee3076165ce6497eDA906E66bB85C5",
				owner
			)
		);

		await network.provider.request({
			method: "hardhat_impersonateAccount",
			params: ["0x8a8e9730646efd1e57453054f1a6366897d7cb1c"],
		});
		await network.provider.request({
			method: "hardhat_impersonateAccount",
			params: ["0x7a16ff8270133f063aab6c9977183d9e72835428"],
		});

		cvxSigner = ethers.provider.getSigner(
			"0x8a8e9730646efd1e57453054f1a6366897d7cb1c"
		);
		crvSigner = ethers.provider.getSigner(
			"0x7a16ff8270133f063aab6c9977183d9e72835428"
		);

		const JPEGIndex = await ethers.getContractFactory("JPEGIndex", owner);
		jpegIndex = await JPEGIndex.deploy();

		await jpegIndex.grantRole(minter_role, owner._address);

		const JPEGIndexStaking = await ethers.getContractFactory("JPEGIndexStaking", owner);
		staking = <JPEGIndexStaking>await upgrades.deployProxy(JPEGIndexStaking, [jpegIndex.address]);

		booster = <IBooster>(
			await ethers.getContractAt(
				"IBooster",
				"0xF403C135812408BFbE8713b5A23a04b3D48AAE31",
				owner
			)
		);

		rewardPool = <IBaseRewardPool>(
			await ethers.getContractAt(
				"IBaseRewardPool",
				"0xb235205E1096E0Ad221Fb7621a2E2cbaB875bE75",
				owner
			)
		);

		const Strategy = await ethers.getContractFactory("DAOStrategyConvex", owner);
		strategy = await Strategy.deploy(
			{
				want: want.address,
				cvx: cvx.address,
				crv: crv.address
			},
			owner._address,
			{
				lp: "0xB576491F1E6e5E62f1d8F26062Ee822B40B0E0d4",
				ethIndex: 0
			},
			{
				lp: "0x8301AE4fc9c624d1D396cbDAa1ed877821D7C511",
				ethIndex: 0
			},
			{
				booster: booster.address,
				baseRewardPool: rewardPool.address,
				pid: 122,
			},
			staking.address,
			{
				numerator: 20,
				denominator: 100,
			}
		);

		await strategy.grantRole(strategist_role, owner._address);
	});

	afterEach(async () => {
		await network.provider.request({
			method: "evm_revert",
			params: [snapshot],
		});
	});

	it("should deposit want on convex", async () => {
		await want.transfer(strategy.address, units(500));
		await strategy["deposit()"]();

		expect(await strategy.depositedAssets()).to.equal(units(500));
	});

	it("should allow strategists to withdraw non strategy tokens", async () => {
		await expect(
			strategy["withdraw(address,address)"](owner._address, want.address)
		).to.be.revertedWith("want");

		await cvx.connect(cvxSigner).transfer(strategy.address, units(500));
		await strategy["withdraw(address,address)"](owner._address, cvx.address);

		expect(await cvx.balanceOf(owner._address)).to.equal(units(500));
	});

	it("should allow the owner to withdraw want", async () => {
		await want.approve(strategy.address, units(100));

		await strategy["deposit(uint256)"](units(100));
		expect(await strategy.depositedAssets()).to.equal(units(100));

		const balanceBefore = await want.balanceOf(owner._address);
		await strategy["withdraw(address,uint256)"](owner._address, units(100));
		expect(await want.balanceOf(owner._address)).to.equal(balanceBefore.add(units(100)));
	});

	it("should allow the owner to call withdrawAll", async () => {
		await want.approve(strategy.address, units(100));

		await strategy["deposit(uint256)"](units(100));
		expect(await strategy.depositedAssets()).to.equal(units(100));

		const balanceBefore = await want.balanceOf(owner._address);
		await strategy.withdrawAll();
		expect(await want.balanceOf(owner._address)).to.equal(balanceBefore.add(units(100)));
	});

	it("should call notifyRewards on JPEGIndexStaking after an harvest", async () => {
		await jpegIndex.mint(owner._address, units(100));
		await jpegIndex.approve(staking.address, units(100));
		await staking.deposit(units(100));

		await expect(strategy.harvest(0)).to.be.revertedWith("INSUFFICIENT_OUT");

		const ownerWantBalance = await want.balanceOf(owner._address);
		await want.transfer(strategy.address, ownerWantBalance);
		await strategy["deposit()"]();

		expect(await strategy.depositedAssets()).to.equal(ownerWantBalance);

		await crv.connect(crvSigner).approve(rewardPool.address, units(1_000_000));
		await rewardPool.connect(crvSigner).donate(units(1_000_000));

		await booster.earmarkRewards(122);

		await timeTravel(86400);

		await strategy.harvest(0);

		expect(await ethers.provider.getBalance(staking.address)).to.be.gt(0);
		expect(await staking.pendingReward(owner._address)).to.be.gt(0);
	});
});
