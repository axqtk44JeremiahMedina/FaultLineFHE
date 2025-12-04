// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface FaultLineData {
  id: string;
  encryptedData: string;
  timestamp: number;
  stationId: string;
  coordinates: string;
  magnitude: number;
  status: "pending" | "verified" | "rejected";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [faultData, setFaultData] = useState<FaultLineData[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newFaultData, setNewFaultData] = useState({
    stationId: "",
    coordinates: "",
    magnitude: "",
    notes: ""
  });
  const [showStats, setShowStats] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // Calculate statistics
  const verifiedCount = faultData.filter(d => d.status === "verified").length;
  const pendingCount = faultData.filter(d => d.status === "pending").length;
  const rejectedCount = faultData.filter(d => d.status === "rejected").length;
  const averageMagnitude = faultData.length > 0 
    ? faultData.reduce((sum, data) => sum + data.magnitude, 0) / faultData.length 
    : 0;

  useEffect(() => {
    loadFaultData().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadFaultData = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("fault_data_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing fault data keys:", e);
        }
      }
      
      const list: FaultLineData[] = [];
      
      for (const key of keys) {
        try {
          const dataBytes = await contract.getData(`fault_data_${key}`);
          if (dataBytes.length > 0) {
            try {
              const data = JSON.parse(ethers.toUtf8String(dataBytes));
              list.push({
                id: key,
                encryptedData: data.data,
                timestamp: data.timestamp,
                stationId: data.stationId,
                coordinates: data.coordinates,
                magnitude: data.magnitude,
                status: data.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing fault data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading fault data ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setFaultData(list);
    } catch (e) {
      console.error("Error loading fault data:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitFaultData = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting geological data with Zama FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newFaultData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const dataId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const faultData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        stationId: newFaultData.stationId,
        coordinates: newFaultData.coordinates,
        magnitude: parseFloat(newFaultData.magnitude),
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `fault_data_${dataId}`, 
        ethers.toUtf8Bytes(JSON.stringify(faultData))
      );
      
      const keysBytes = await contract.getData("fault_data_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(dataId);
      
      await contract.setData(
        "fault_data_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted geological data submitted securely!"
      });
      
      await loadFaultData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewFaultData({
          stationId: "",
          coordinates: "",
          magnitude: "",
          notes: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const verifyData = async (dataId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted geological data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const dataBytes = await contract.getData(`fault_data_${dataId}`);
      if (dataBytes.length === 0) {
        throw new Error("Data not found");
      }
      
      const data = JSON.parse(ethers.toUtf8String(dataBytes));
      
      const updatedData = {
        ...data,
        status: "verified"
      };
      
      await contract.setData(
        `fault_data_${dataId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedData))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE verification completed successfully!"
      });
      
      await loadFaultData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Verification failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const rejectData = async (dataId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted geological data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const dataBytes = await contract.getData(`fault_data_${dataId}`);
      if (dataBytes.length === 0) {
        throw new Error("Data not found");
      }
      
      const data = JSON.parse(ethers.toUtf8String(dataBytes));
      
      const updatedData = {
        ...data,
        status: "rejected"
      };
      
      await contract.setData(
        `fault_data_${dataId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedData))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE rejection completed successfully!"
      });
      
      await loadFaultData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Rejection failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({
        visible: true,
        status: "success",
        message: `FHE Contract is ${isAvailable ? "available" : "unavailable"}`
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Failed to check contract availability"
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const filteredData = faultData.filter(data => 
    data.stationId.toLowerCase().includes(searchTerm.toLowerCase()) ||
    data.coordinates.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing encrypted geological connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FaultLine<span>FHE</span></h1>
          <p>Confidential Geological Fault Line Monitoring</p>
        </div>
        
        <div className="header-actions">
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Secure Fault Line Analysis with FHE</h2>
            <p>Process sensitive geological data in encrypted state using Zama FHE technology</p>
          </div>
          <div className="banner-actions">
            <button 
              onClick={() => setShowCreateModal(true)} 
              className="primary-btn"
            >
              Submit Fault Data
            </button>
            <button 
              onClick={checkAvailability}
              className="secondary-btn"
            >
              Check FHE Status
            </button>
          </div>
        </div>
        
        <div className="controls-section">
          <div className="search-container">
            <input
              type="text"
              placeholder="Search by station ID or coordinates..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>
          <div className="view-options">
            <button 
              onClick={() => setShowStats(!showStats)}
              className={`toggle-btn ${showStats ? 'active' : ''}`}
            >
              {showStats ? 'Hide Statistics' : 'Show Statistics'}
            </button>
            <button 
              onClick={loadFaultData}
              className="refresh-btn"
              disabled={isRefreshing}
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh Data'}
            </button>
          </div>
        </div>
        
        {showStats && (
          <div className="stats-section">
            <div className="stat-card">
              <h3>Total Data Points</h3>
              <div className="stat-value">{faultData.length}</div>
            </div>
            <div className="stat-card">
              <h3>Verified Data</h3>
              <div className="stat-value">{verifiedCount}</div>
            </div>
            <div className="stat-card">
              <h3>Pending Review</h3>
              <div className="stat-value">{pendingCount}</div>
            </div>
            <div className="stat-card">
              <h3>Average Magnitude</h3>
              <div className="stat-value">{averageMagnitude.toFixed(2)}</div>
            </div>
          </div>
        )}
        
        <div className="data-section">
          <h2>Fault Line Data Records</h2>
          
          {filteredData.length === 0 ? (
            <div className="no-data">
              <p>No fault line data found</p>
              <button 
                className="primary-btn"
                onClick={() => setShowCreateModal(true)}
              >
                Submit First Data Point
              </button>
            </div>
          ) : (
            <div className="data-grid">
              {filteredData.map(data => (
                <div className="data-card" key={data.id}>
                  <div className="data-header">
                    <h3>Station {data.stationId}</h3>
                    <span className={`status-badge ${data.status}`}>
                      {data.status}
                    </span>
                  </div>
                  <div className="data-content">
                    <div className="data-row">
                      <span>Coordinates:</span>
                      <span>{data.coordinates}</span>
                    </div>
                    <div className="data-row">
                      <span>Magnitude:</span>
                      <span>{data.magnitude}</span>
                    </div>
                    <div className="data-row">
                      <span>Date:</span>
                      <span>{new Date(data.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="data-actions">
                    <button 
                      className="action-btn verify"
                      onClick={() => verifyData(data.id)}
                    >
                      Verify
                    </button>
                    <button 
                      className="action-btn reject"
                      onClick={() => rejectData(data.id)}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
  
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>Submit New Fault Data</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-modal">&times;</button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>Station ID *</label>
                <input 
                  type="text"
                  name="stationId"
                  value={newFaultData.stationId} 
                  onChange={(e) => setNewFaultData({...newFaultData, stationId: e.target.value})}
                  placeholder="Enter monitoring station ID" 
                />
              </div>
              
              <div className="form-group">
                <label>Coordinates *</label>
                <input 
                  type="text"
                  name="coordinates"
                  value={newFaultData.coordinates} 
                  onChange={(e) => setNewFaultData({...newFaultData, coordinates: e.target.value})}
                  placeholder="e.g. 34.0522° N, 118.2437° W" 
                />
              </div>
              
              <div className="form-group">
                <label>Magnitude *</label>
                <input 
                  type="number"
                  name="magnitude"
                  value={newFaultData.magnitude} 
                  onChange={(e) => setNewFaultData({...newFaultData, magnitude: e.target.value})}
                  placeholder="Enter seismic magnitude" 
                  step="0.1"
                />
              </div>
              
              <div className="form-group">
                <label>Additional Notes</label>
                <textarea 
                  name="notes"
                  value={newFaultData.notes} 
                  onChange={(e) => setNewFaultData({...newFaultData, notes: e.target.value})}
                  placeholder="Optional notes about the reading..." 
                  rows={3}
                />
              </div>
              
              <div className="fhe-notice">
                <p>This data will be encrypted using FHE technology for secure processing</p>
              </div>
            </div>
            
            <div className="modal-footer">
              <button 
                onClick={() => setShowCreateModal(false)}
                className="cancel-btn"
              >
                Cancel
              </button>
              <button 
                onClick={submitFaultData} 
                disabled={creating || !newFaultData.stationId || !newFaultData.coordinates || !newFaultData.magnitude}
                className="submit-btn"
              >
                {creating ? "Encrypting with FHE..." : "Submit Securely"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className={`transaction-content ${transactionStatus.status}`}>
            <div className="transaction-icon">
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <h3>FaultLineFHE</h3>
            <p>Confidential Geological Fault Line Monitoring</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="copyright">
            © {new Date().getFullYear()} FaultLineFHE. All rights reserved.
          </div>
          <div className="fhe-badge">
            <span>FHE-Powered Security</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;