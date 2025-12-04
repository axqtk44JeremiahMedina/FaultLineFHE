// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract FaultLineFHE is SepoliaConfig {
    struct EncryptedSeismicData {
        uint256 stationId;
        address researchOrg;
        euint32 groundMotion;
        euint32 crustalDeformation;
        euint32 faultStress;
        uint256 timestamp;
    }

    struct RiskAssessment {
        uint256 assessmentId;
        euint32 activityLevel;
        euint32 riskScore;
        uint256 timestamp;
    }

    uint256 public stationCount;
    uint256 public assessmentCount;
    mapping(uint256 => EncryptedSeismicData) public seismicData;
    mapping(uint256 => RiskAssessment) public riskAssessments;
    mapping(address => uint256[]) public orgStations;
    mapping(address => bool) public authorizedOrgs;

    event DataSubmitted(uint256 indexed stationId, address indexed org, uint256 timestamp);
    event AssessmentRequested(uint256 indexed assessmentId);
    event AssessmentCompleted(uint256 indexed assessmentId, uint256 timestamp);

    modifier onlyAuthorized() {
        require(authorizedOrgs[msg.sender], "Unauthorized organization");
        _;
    }

    constructor() {
        authorizedOrgs[msg.sender] = true;
    }

    function authorizeOrganization(address org) external onlyAuthorized {
        authorizedOrgs[org] = true;
    }

    function submitSeismicData(
        euint32 encryptedMotion,
        euint32 encryptedDeformation,
        euint32 encryptedStress
    ) external onlyAuthorized {
        stationCount++;
        uint256 newId = stationCount;

        seismicData[newId] = EncryptedSeismicData({
            stationId: newId,
            researchOrg: msg.sender,
            groundMotion: encryptedMotion,
            crustalDeformation: encryptedDeformation,
            faultStress: encryptedStress,
            timestamp: block.timestamp
        });

        orgStations[msg.sender].push(newId);
        emit DataSubmitted(newId, msg.sender, block.timestamp);
    }

    function requestRiskAssessment() external onlyAuthorized {
        assessmentCount++;
        uint256 newId = assessmentCount;

        bytes32[] memory ciphertexts = new bytes32[](stationCount * 3);
        uint256 index = 0;
        
        for (uint256 i = 1; i <= stationCount; i++) {
            ciphertexts[index++] = FHE.toBytes32(seismicData[i].groundMotion);
            ciphertexts[index++] = FHE.toBytes32(seismicData[i].crustalDeformation);
            ciphertexts[index++] = FHE.toBytes32(seismicData[i].faultStress);
        }

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.performAssessment.selector);
        emit AssessmentRequested(newId);
    }

    function performAssessment(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) external {
        FHE.checkSignatures(requestId, cleartexts, proof);

        euint32[] memory results = abi.decode(cleartexts, (euint32[]));
        
        riskAssessments[requestId] = RiskAssessment({
            assessmentId: requestId,
            activityLevel: results[0],
            riskScore: results[1],
            timestamp: block.timestamp
        });

        emit AssessmentCompleted(requestId, block.timestamp);
    }

    function getStationData(uint256 stationId) external view onlyAuthorized returns (
        euint32, euint32, euint32
    ) {
        EncryptedSeismicData storage data = seismicData[stationId];
        return (data.groundMotion, data.crustalDeformation, data.faultStress);
    }

    function getRiskAssessment(uint256 assessmentId) external view onlyAuthorized returns (
        euint32, euint32
    ) {
        RiskAssessment storage assessment = riskAssessments[assessmentId];
        return (assessment.activityLevel, assessment.riskScore);
    }

    function getOrgStations(address org) external view onlyAuthorized returns (
        uint256[] memory
    ) {
        return orgStations[org];
    }
}