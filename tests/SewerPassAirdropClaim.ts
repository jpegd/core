import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers, network } from "hardhat";
import {
    IERC721,
    SewerPassAirdropClaim,
} from "../types";
import { BigNumber } from "ethers";
import { AbiCoder } from "ethers/lib/utils";

const { expect } = chai;

chai.use(solidity);

const vault_role = "0x31e0210044b4f6757ce6aa31f9c6e8d4896d24a755014887391a926c5224d959";

describe("SewerPassAirdropClaim", () => {
    let user: SignerWithAddress;
    let owner: SignerWithAddress;
    let claim: SewerPassAirdropClaim;
    let sewerPass: IERC721;
    let bayc: IERC721;
    let mayc: IERC721;
    let bakc: IERC721;

    beforeEach(async () => {
        const accounts = await ethers.getSigners();
        owner = accounts[0];

        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0x08c1ae7e46d4a13b766566033b5c47c735e19f6f"],
        });

        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0x51C2cEF9efa48e08557A361B52DB34061c025a1B"],
        });

        user = await ethers.getSigner("0x08c1ae7e46d4a13b766566033b5c47c735e19f6f");

        await owner.sendTransaction({ from: owner.address, to: user.address, value: BigNumber.from(1e18.toString()) })
        
        bayc = <IERC721>(await ethers.getContractAt("IERC721", "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D", owner));
        mayc = <IERC721>(await ethers.getContractAt("IERC721", "0x60E4d786628Fea6478F785A6d7e704777c86a7c6", owner));
        bakc = <IERC721>(await ethers.getContractAt("IERC721", "0xba30E5F9Bb24caa003E9f2f0497Ad287FDF95623", owner));
        sewerPass = <IERC721>(await ethers.getContractAt("IERC721", "0x764AeebcF425d56800eF2c84F2578689415a2DAa", owner));

        const Claim = await ethers.getContractFactory("SewerPassAirdropClaim");
        claim = await Claim.deploy();

        await claim.grantRole(vault_role, owner.address);
    });

    it("should mint sewer passes", async () => {
        const baycIds = [2992, 3143, 4564, 5323];
        const bakcIds = [9502, 9503, 8192, 8198];

        await bakc.connect(user).setApprovalForAll(claim.address, true);

        await bakc.connect(user).transferFrom(user.address, claim.address, bakcIds[0]);
        await bayc.connect(user).transferFrom(user.address, claim.address, baycIds[0]);
        await bayc.connect(user).transferFrom(user.address, claim.address, baycIds[1]);
        await bayc.connect(user).transferFrom(user.address, claim.address, baycIds[2]);
        await bayc.connect(user).transferFrom(user.address, claim.address, baycIds[3]);

        await claim.afterDeposit(user.address, owner.address, baycIds, new AbiCoder().encode(["tuple(uint256,bool)[]", "uint256"], [[[bakcIds[0], false], [bakcIds[1], true]], 0]))

        expect(await bakc.ownerOf(bakcIds[0])).to.equal(owner.address);
        expect(await bakc.ownerOf(bakcIds[1])).to.equal(user.address);
        expect(await bayc.ownerOf(baycIds[0])).to.equal(owner.address);
        expect(await bayc.ownerOf(baycIds[1])).to.equal(owner.address);
        expect(await bayc.ownerOf(baycIds[2])).to.equal(owner.address);
        expect(await bayc.ownerOf(baycIds[3])).to.equal(owner.address);

        const maycIds = [17169, 17848, 28674, 13684];

        await bakc.connect(user).transferFrom(user.address, claim.address, bakcIds[2]);
        await mayc.connect(user).transferFrom(user.address, claim.address, maycIds[0]);
        await mayc.connect(user).transferFrom(user.address, claim.address, maycIds[1]);
        await mayc.connect(user).transferFrom(user.address, claim.address, maycIds[2]);
        await mayc.connect(user).transferFrom(user.address, claim.address, maycIds[3]);

        await claim.afterDeposit(user.address, owner.address, maycIds, new AbiCoder().encode(["tuple(uint256,bool)[]", "uint256"], [[[bakcIds[2], false], [bakcIds[3], true]], 1]))

        expect(await bakc.ownerOf(bakcIds[0])).to.equal(owner.address);
        expect(await bakc.ownerOf(bakcIds[1])).to.equal(user.address);
        expect(await mayc.ownerOf(maycIds[0])).to.equal(owner.address);
        expect(await mayc.ownerOf(maycIds[1])).to.equal(owner.address);
        expect(await mayc.ownerOf(maycIds[2])).to.equal(owner.address);
        expect(await mayc.ownerOf(maycIds[3])).to.equal(owner.address);
    });
});