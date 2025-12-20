/* eslint no-unused-vars: ["warn", { "vars": "local", "args": "none" }] */
/* global browser, XLSX, Chart, ApexCharts */
/* eslint-disable no-unused-vars */
// Cross-browser extension API helper
// In Chrome, `chrome` exists. In Firefox, `browser` exists.
// This picks whichever is available, so the rest of the code can use `ext`.
const ext = (typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null));

// Cross-browser background messaging helper (returns a Promise)
function bgSend(msg) {
    return new Promise((resolve) => {
        try {
            if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.sendMessage) {
                // browser APIs return a Promise
                browser.runtime.sendMessage(msg).then(res => resolve(res)).catch(err => resolve({ success: false, error: err && err.message ? err.message : String(err) }));
            } else if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                // chrome uses a callback
                chrome.runtime.sendMessage(msg, (res) => resolve(res));
            } else {
                resolve({ success: false, error: 'No runtime messaging API available' });
            }
        } catch (e) {
            resolve({ success: false, error: e && e.message ? e.message : String(e) });
        }
    });
}


// ========== GLOBAL STATE MANAGEMENT ==========
// Global variables
let strategies = []; // Array of all strategies
let currentStrategyId = null; // ID of currently active strategy
let myChart = null;
let projectionChart = null;
let dumbbellChart = null;
let compareChart = null;
let currentView = 'INR';
let currentPLType = 'NET';
let forecastingEnabled = false;
let extremeScenarioEnabled = false;
let currentForecastView = '1Yr'; // '1Yr', '2Yr', or '4Yr'
let currentProjections = null;
let pendingFileData = null; // Temporary storage for file data during column mapping
let isAddingNewStrategy = false; // Flag to track if we're adding a new strategy
let instrumentsLibrary = []; // Global library of all uploaded instruments
let pendingInstrumentData = null; // Temporary storage during upload




// Strategy structure:
// {
//   id: unique string,
//   name: string,
//   fileName: string,
//   lastUpdated: date string,
//   capital: number,
//   columnMapping: { date, pl, charges, lots, entryType, exitCriteria },
//   allTradesData: array,
//   tradesData: array (filtered),
//   selectedYear: string,
//   selectedMonth: object or null
// }


// ========== fUtility Functions declaration ==========


function formatLastUpdated(isoString) {
    const date = new Date(isoString);
    const dateStr = date.getDate().toString().padStart(2, '0') + '/' +
        (date.getMonth() + 1).toString().padStart(2, '0') + '/' +
        date.getFullYear();
    const timeStr = date.getHours().toString().padStart(2, '0') + ':' +
        date.getMinutes().toString().padStart(2, '0') + ' ' +
        (date.getHours() >= 12 ? 'PM' : 'AM');
    return dateStr + '  ' + timeStr;
}

function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}

function hideError() {
    document.getElementById('errorMessage').style.display = 'none';
}

function hideAllDashboardSections() {
    document.getElementById('mainContent').style.display = 'none';
    document.getElementById('miniChartsSection').style.display = 'none';  // NEW
    document.getElementById('lowerSection').style.display = 'none';
    document.getElementById('forecastingToggleContainer').style.display = 'none';
    document.getElementById('forecastingSection').style.display = 'none';
    document.getElementById('overviewHeaderCompact').style.display = 'none';
}

function openInstrumentModal() {
    console.log('Opening instrument modal');

    // Populate dropdown with existing instruments
    populateInstrumentSelector();

    // Show modal
    document.getElementById('instrumentModal').style.display = 'flex';

    // Reset form
    document.getElementById('instrumentName').value = '';
    document.getElementById('instrumentFileName').textContent = '';
    document.getElementById('instrumentError').style.display = 'none';
    pendingInstrumentData = null;

    // Pre-select current strategy's instrument if any
    const strategy = getStrategy(currentStrategyId);
    if (strategy && strategy.selectedInstrument) {
        document.getElementById('instrumentSelector').value = strategy.selectedInstrument;
    } else {
        document.getElementById('instrumentSelector').value = '';
    }
}


// Update button appearance based on instrument status
function updateInstrumentButton() {
    const btn = document.getElementById('btnAddInstrument');
    const strategy = getStrategy(currentStrategyId);

    if (strategy && strategy.selectedInstrument) {
        btn.classList.add('active');
        const instrument = instrumentsLibrary.find(i => i.id === strategy.selectedInstrument);
        if (instrument) {
            btn.querySelector('.instrument-text').textContent = instrument.name;
        }
    } else {
        btn.classList.remove('active');
        btn.querySelector('.instrument-text').textContent = 'Add Instrument';
    }
}

// ========== FORECASTING Variables declaration ==========

function enableForecasting() {
    forecastingEnabled = true;
    document.getElementById('forecastingToggleContainer').style.display = 'none';
    document.getElementById('forecastingSection').style.display = 'block';
    generateForecasting();
}

function disableForecasting() {
    forecastingEnabled = false;
    extremeScenarioEnabled = false;
    document.getElementById('toggleExtreme').classList.remove('active');
    document.getElementById('forecastingSection').style.display = 'none';
    document.getElementById('forecastingToggleContainer').style.display = 'block';
}

function toggleExtreme() {
    extremeScenarioEnabled = !extremeScenarioEnabled;
    document.getElementById('toggleExtreme').classList.toggle('active', extremeScenarioEnabled);

    if (currentProjections) {
        createProjectionChart(currentProjections.projections, currentProjections.currentPL);
    }
}


// ========== INITIALIZATION ==========

document.addEventListener('DOMContentLoaded', function() {
    loadTheme();
    setupThemeControls();
    loadStrategiesFromStorage();
    loadInstrumentsFromStorage();
    setupEventListeners();
    setupSheetsEventListeners();  // ✅ ADD THIS LINE HERE
    
    if (strategies.length === 0) {
        showInitialUploadState();
    } else {
        showStrategyBar();
        renderStrategyTabs();
        if (currentStrategyId) {
            switchToStrategy(currentStrategyId);
        }
    }
});

function loadTheme() {
    const savedTheme = localStorage.getItem('dashboardTheme') || 'light';
    const savedAccent = localStorage.getItem('dashboardAccent') || 'blue';
    
    document.documentElement.setAttribute('data-theme', savedTheme);
    document.documentElement.setAttribute('data-accent', savedAccent);
    
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.textContent = savedTheme === 'dark' ? '☀️' : '🌙';
    }
    
    document.querySelectorAll('.accent-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.accent === savedAccent) {
            btn.classList.add('active');
        }
    });
}

function setupThemeControls() {
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', function() {
            const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
            const newTheme = currentTheme === 'light' ? 'dark' : 'light';
            
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('dashboardTheme', newTheme);
            this.textContent = newTheme === 'dark' ? '☀️' : '🌙';
            
            refreshAllCharts();
        });
    }
    
    document.querySelectorAll('.accent-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const accent = this.dataset.accent;
            document.documentElement.setAttribute('data-accent', accent);
            localStorage.setItem('dashboardAccent', accent);
            
            document.querySelectorAll('.accent-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            refreshAllCharts();
        });
    });
}


function setupEventListeners() {
    // File upload
    document.getElementById('fileInput').addEventListener('change', handleFileUpload);
    
   // Capital input
document.getElementById('capitalInput').addEventListener('input', function() {
    if (currentStrategyId) {
        const strategy = getStrategy(currentStrategyId);
        strategy.capital = parseFloat(this.value) || 350000;
        saveStrategiesToStorage();
        applyFiltersAndUpdate();
    }

});
    
    // Chart controls
    document.getElementById('btnINR').addEventListener('click', () => switchView('INR'));
    document.getElementById('btnPercent').addEventListener('click', () => switchView('PERCENT'));
    document.getElementById('btnGross').addEventListener('click', () => switchPLType('GROSS'));
    document.getElementById('btnNet').addEventListener('click', () => switchPLType('NET'));
   
    // Instrument data button
    document.getElementById('btnAddInstrument').addEventListener('click', function () {
        const strategy = getStrategy(currentStrategyId);

        // If already has instrument, ask to change or remove
        if (strategy && strategy.selectedInstrument) {
            const instrument = instrumentsLibrary.find(i => i.id === strategy.selectedInstrument);
            const instrumentName = instrument ? instrument.name : 'Unknown';

            const choice = confirm(`Current: ${instrumentName}\n\nOK = Change instrument\nCancel = Remove instrument`);

            if (choice) {
                // Change instrument
                openInstrumentModal();
            } else {
                // Remove instrument
                unlinkInstrumentFromStrategy();
            }
        } else {
            // No instrument - open modal
            openInstrumentModal();
        }
    });

    
    // Month filter
    document.getElementById('clearMonthFilter').addEventListener('click', clearMonthFilter);
    
    // Forecasting
    document.getElementById('toggleForecasting').addEventListener('click', enableForecasting);
    document.getElementById('disableForecasting').addEventListener('click', disableForecasting);
    document.getElementById('toggleExtreme').addEventListener('click', toggleExtreme);
    
    // Forecast view buttons
    document.getElementById('view1Yr').addEventListener('click', () => switchForecastView('1Yr'));
    document.getElementById('view2Yr').addEventListener('click', () => switchForecastView('2Yr'));
    document.getElementById('view4Yr').addEventListener('click', () => switchForecastView('4Yr'));
    
    // Strategy management
    document.getElementById('addStrategyBtn').addEventListener('click', addNewStrategy);
    document.getElementById('compareStrategiesBtn').addEventListener('click', openCompareStrategies);
    document.getElementById('closeCompare').addEventListener('click', closeCompareStrategies);
    document.getElementById('exportStrategiesBtn').addEventListener('click', exportStrategies);
    document.getElementById('importStrategiesBtn').addEventListener('click', () => {
        document.getElementById('importFileInput').click();
    });
    document.getElementById('importFileInput').addEventListener('change', importStrategies);
    
    // Column mapping modal
    document.getElementById('toggleAdditional').addEventListener('change', function() {
        document.getElementById('additionalFields').style.display = this.checked ? 'block' : 'none';
    });
    document.getElementById('cancelMapping').addEventListener('click', cancelColumnMapping);
    document.getElementById('confirmMapping').addEventListener('click', confirmColumnMapping);

    // Add Strategy modal buttons (with null checks)
const chooseFileBtn = document.getElementById('chooseFileUpload');
const chooseSheetsBtn = document.getElementById('chooseGoogleSheets');
const cancelAddBtn = document.getElementById('cancelAddStrategy');

if (chooseFileBtn) chooseFileBtn.onclick = handleFileUploadChoice;
if (chooseSheetsBtn) chooseSheetsBtn.onclick = handleGoogleSheetsChoice;
if (cancelAddBtn) cancelAddBtn.onclick = closeAddStrategyModal;


}  // ← ADD THIS CLOSING BRACE!

// ========== LOCAL STORAGE ==========

function saveStrategiesToStorage() {
    try {
        localStorage.setItem('tradingStrategies', JSON.stringify(strategies));
        localStorage.setItem('currentStrategyId', currentStrategyId);
        console.log('✅ Strategies saved to storage');
    } catch (e) {
        console.error('❌ Failed to save strategies:', e);
        showError('Failed to save data. Storage may be full.');
    }
}

function loadStrategiesFromStorage() {
    try {
        const saved = localStorage.getItem('tradingStrategies');
        if (saved) {
            strategies = JSON.parse(saved);
            // Convert date strings back to Date objects
            strategies.forEach(strategy => {
                strategy.allTradesData.forEach(trade => {
                    trade.date = new Date(trade.date);
                });
                if (strategy.tradesData) {
                    strategy.tradesData.forEach(trade => {
                        trade.date = new Date(trade.date);
                    });
                }
            });
            console.log('✅ Loaded', strategies.length, 'strategies from storage');
        }
        
        currentStrategyId = localStorage.getItem('currentStrategyId');
    } catch (e) {
        console.error('❌ Failed to load strategies:', e);
        strategies = [];
        currentStrategyId = null;
    }
}

// ==========================================
// INSTRUMENT DATA - LOCALSTORAGE
// ==========================================

function saveInstrumentsToStorage() {
    try {
        localStorage.setItem('instrumentsLibrary', JSON.stringify(instrumentsLibrary));
        console.log('Instruments saved:', instrumentsLibrary.length);
    } catch (e) {
        console.error('Failed to save instruments:', e);
        showError('Failed to save instrument data. Storage may be full.');
    }
}

function loadInstrumentsFromStorage() {
    try {
        const saved = localStorage.getItem('instrumentsLibrary');
        if (saved) {
            instrumentsLibrary = JSON.parse(saved);
            // Convert date strings back to Date objects
            instrumentsLibrary.forEach(instrument => {
                instrument.data.forEach(point => {
                    point.date = new Date(point.date);
                });
            });
            console.log('Loaded', instrumentsLibrary.length, 'instruments from storage');
        }
    } catch (e) {
        console.error('Failed to load instruments:', e);
        instrumentsLibrary = [];
    }
}


// ========== STRATEGY MANAGEMENT ==========

function showInitialUploadState() {
    document.getElementById('strategyBar').style.display = 'none';
    document.getElementById('overviewHeaderCompact').style.display = 'none'; // ← ADD THIS
    document.getElementById('strategyName').textContent = 'No strategy loaded';
    document.getElementById('fileName').textContent = '--';
    document.getElementById('lastUpdated').textContent = '--';
    document.getElementById('totalTradesCount').textContent = '0';
    document.getElementById('capitalInputContainer').style.display = 'none';
    document.getElementById('uploadBtnLabel').innerHTML = '📁 Upload File<input type="file" id="fileInput" accept=".xlsx,.xls,.csv" style="display: none;">';
    document.getElementById('importBtnInitial').style.display = 'inline-block';
    document.getElementById('connectSheetsBtn').style.display = 'inline-block'; // NEW
    document.getElementById('sheetSourceInfo').style.display = 'none'; // NEW
    document.getElementById('refreshSheetData').style.display = 'none'; // NEW
    
    document.getElementById('fileInput').addEventListener('change', handleFileUpload);
    document.getElementById('importBtnInitial').addEventListener('click', function() {
        document.getElementById('importFileInput').click();
    });
}


function showStrategyBar() {
    document.getElementById('strategyBar').style.display = 'flex';
}

function addNewStrategy() {
    if (strategies.length >= 10) {
        showError('Maximum 10 strategies allowed');
        return;
    }
    isAddingNewStrategy = true;
    // Show the choice modal instead of directly opening file input
    document.getElementById('addStrategyModal').style.display = 'flex';
}

// Close add strategy modal
function closeAddStrategyModal() {
    document.getElementById('addStrategyModal').style.display = 'none';
    isAddingNewStrategy = false;
}

// Handle file upload choice
function handleFileUploadChoice() {
    // DON'T reset isAddingNewStrategy flag
    document.getElementById('addStrategyModal').style.display = 'none';
    // Trigger file input
    document.getElementById('fileInput').click();
}


// Handle Google Sheets choice
function handleGoogleSheetsChoice() {
    // DON'T reset isAddingNewStrategy flag
    document.getElementById('addStrategyModal').style.display = 'none';
    // Open Google Sheets connection modal
    openSheetsConnection();
}


function createStrategy(name, fileName, columnMapping, allTradesData, capital = 350000) {
    const strategy = {
        id: 'strategy_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        name: name,
        fileName: fileName,
        lastUpdated: new Date().toISOString(),
        capital: capital,
        columnMapping: columnMapping,
        allTradesData: allTradesData,
        tradesData: [...allTradesData],
        selectedYear: 'ALL',
        selectedMonth: null,
        source: { type: 'file', config: {} } // NEW: default to file source
    };
    
    strategies.push(strategy);
    currentStrategyId = strategy.id;
    saveStrategiesToStorage();
    
    showStrategyBar();
    renderStrategyTabs();
    switchToStrategy(strategy.id);
    
    console.log('✅ Created strategy:', strategy.name);
    
    return strategy; // NEW: return strategy object
}


function getStrategy(id) {
    return strategies.find(s => s.id === id);
}

function updateStrategy(id, updates) {
    const strategy = getStrategy(id);
    if (strategy) {
        Object.assign(strategy, updates);
        saveStrategiesToStorage();
    }
}

function deleteStrategy(id) {
    const strategy = getStrategy(id);
    if (!strategy) return;
    
    if (!confirm(`Delete strategy "${strategy.name}"? This cannot be undone.`)) {
        return;
    }
    
    strategies = strategies.filter(s => s.id !== id);
    
    if (currentStrategyId === id) {
        currentStrategyId = strategies.length > 0 ? strategies[0].id : null;
    }
    
    saveStrategiesToStorage();
    
    if (strategies.length === 0) {
        showInitialUploadState();
        hideAllDashboardSections();
    } else {
        renderStrategyTabs();
        if (currentStrategyId) {
            switchToStrategy(currentStrategyId);
        }
    }
    
    console.log('✅ Deleted strategy:', strategy.name);
}

function switchToStrategy(id) {
    const strategy = getStrategy(id);
    if (!strategy) return;
    
    currentStrategyId = id;
    saveStrategiesToStorage();
    
    // Update file info
    document.getElementById('strategyName').textContent = strategy.name;
    document.getElementById('fileName').textContent = strategy.fileName;
    document.getElementById('lastUpdated').textContent = formatLastUpdated(strategy.lastUpdated);
    document.getElementById('totalTradesCount').textContent = strategy.allTradesData.length;
    document.getElementById('capitalInput').value = strategy.capital;
    document.getElementById('capitalInputContainer').style.display = 'flex';
    document.getElementById('importBtnInitial').style.display = 'none';
    document.getElementById('connectSheetsBtn').style.display = 'none';
    
    // Update upload button based on source type
    const uploadBtn = document.getElementById('uploadBtnLabel');
    if (uploadBtn) {
        if (strategy.source && strategy.source.type === 'sheets') {
            uploadBtn.style.display = 'none';
        } else {
            uploadBtn.style.display = 'inline-block';
            uploadBtn.innerHTML = '📁 Update Trades<input type="file" id="fileInput" accept=".xlsx,.xls,.csv" style="display: none">';
            const fileInput = document.getElementById('fileInput');
            if (fileInput) {
                fileInput.removeEventListener('change', handleFileUpload);
                fileInput.addEventListener('change', handleFileUpload);
            }
        }
    }
    
    // Update strategy tabs
    document.querySelectorAll('.strategy-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.strategyId === id);
    });
    
    // Update UI based on source type
    updateUIForSheetsSource(id);
    
    // Apply filters and update dashboard
    applyFiltersAndUpdate();
    
    console.log('Switched to strategy:', strategy.name);
    // Update instrument button state
    updateInstrumentButton();

}



function renderStrategyTabs() {
    const container = document.getElementById('strategyTabs');
    container.innerHTML = '';
    
    strategies.forEach(strategy => {
        const tab = document.createElement('div');
        tab.className = 'strategy-tab';
        tab.dataset.strategyId = strategy.id;
        if (strategy.id === currentStrategyId) {
            tab.classList.add('active');
        }
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'strategy-name';
        nameSpan.textContent = strategy.name;
        nameSpan.title = strategy.name;
        
        const actions = document.createElement('div');
        actions.className = 'strategy-tab-actions';
        
        const editBtn = document.createElement('button');
        editBtn.className = 'edit-strategy-btn';
        editBtn.innerHTML = '✏️';
        editBtn.title = 'Edit name';
        editBtn.onclick = (e) => {
            e.stopPropagation();
            editStrategyName(strategy.id);
        };
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-strategy-btn';
        deleteBtn.innerHTML = '🗑️';
        deleteBtn.title = 'Delete strategy';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            deleteStrategy(strategy.id);
        };
        
        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);
        
        tab.appendChild(nameSpan);
        tab.appendChild(actions);
        
        tab.onclick = () => switchToStrategy(strategy.id);
        
        container.appendChild(tab);
    });
}

function editStrategyName(id) {
    const strategy = getStrategy(id);
    if (!strategy) return;
    
    const newName = prompt('Enter new strategy name (max 20 characters):', strategy.name);
    if (newName && newName.trim()) {
        strategy.name = newName.trim().substring(0, 20);
        saveStrategiesToStorage();
        renderStrategyTabs();
        if (currentStrategyId === id) {
            document.getElementById('strategyName').textContent = strategy.name;
        }
        console.log('✅ Renamed strategy to:', strategy.name);
    }
}

// ========== FILE UPLOAD & COLUMN MAPPING ==========

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array', cellDates: true });
            
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(firstSheet, { raw: false, dateNF: 'dd-mm-yyyy', header: 1 });
            
            console.log('✅ Loaded', jsonData.length, 'rows from file');
            
            if (jsonData.length === 0) {
                showError('No data found in the file');
                return;
            }
            
            // Store file data temporarily
            pendingFileData = {
                fileName: file.name,
                jsonData: jsonData
            };
            
            // If updating existing strategy, pre-fill mapping
            if (currentStrategyId) {
                const strategy = getStrategy(currentStrategyId);
                showColumnMappingModal(jsonData, strategy.columnMapping);
            } else {
                showColumnMappingModal(jsonData, null);
            }
            
        } catch (error) {
            showError('Error reading file: ' + error.message);
            console.error('File read error:', error);
        }
    };
    
    reader.readAsArrayBuffer(file);
    
    // Reset file input
    event.target.value = '';
}

function showColumnMappingModal(jsonData, existingMapping = null) {
    const headers = jsonData[0];
    
    // Populate dropdowns
    const dropdowns = ['dateColumn', 'plColumn', 'chargesColumn', 'lotsColumn', 'entryTypeColumn', 'exitCriteriaColumn'];
    dropdowns.forEach(dropdownId => {
        const select = document.getElementById(dropdownId);
        select.innerHTML = '<option value="">-- Select Column --</option>';
        headers.forEach((header, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = `Column ${index + 1} - ${header}`;
            select.appendChild(option);
        });
    });
    
    // Auto-detect or pre-fill
    if (existingMapping) {
        // Pre-fill with existing mapping
        if (existingMapping.date !== null) document.getElementById('dateColumn').value = existingMapping.date;
        if (existingMapping.pl !== null) document.getElementById('plColumn').value = existingMapping.pl;
        if (existingMapping.charges !== null) document.getElementById('chargesColumn').value = existingMapping.charges;
        if (existingMapping.lots !== null) document.getElementById('lotsColumn').value = existingMapping.lots;
        if (existingMapping.entryType !== null) document.getElementById('entryTypeColumn').value = existingMapping.entryType;
        if (existingMapping.exitCriteria !== null) document.getElementById('exitCriteriaColumn').value = existingMapping.exitCriteria;
    } else {
        // Auto-detect
        autoDetectColumns(headers);
    }
    
    document.getElementById('mappingModal').style.display = 'flex';
}

function autoDetectColumns(headers) {
    const dateKeywords = ['date', 'day', 'time', 'dt', 'fecha'];
    const plKeywords = ['profit', 'loss', 'p&l', 'pl', 'pnl', 'return', 'ganancia', 'perdida'];
    const chargesKeywords = ['charge', 'fee', 'commission', 'cost', 'expense', 'comision', 'cargo'];
    const lotsKeywords = ['lot', 'delta', 'size', 'quantity', 'qty', 'cantidad', 'tamaño'];
    
    headers.forEach((header, index) => {
        const lowerHeader = header.toString().toLowerCase();
        
        if (dateKeywords.some(kw => lowerHeader.includes(kw))) {
            document.getElementById('dateColumn').value = index;
        }
        if (plKeywords.some(kw => lowerHeader.includes(kw))) {
            document.getElementById('plColumn').value = index;
        }
        if (chargesKeywords.some(kw => lowerHeader.includes(kw))) {
            document.getElementById('chargesColumn').value = index;
        }
        if (lotsKeywords.some(kw => lowerHeader.includes(kw))) {
            document.getElementById('lotsColumn').value = index;
        }
    });
}

function cancelColumnMapping() {
    document.getElementById('mappingModal').style.display = 'none';
    document.getElementById('mappingError').style.display = 'none';
    pendingFileData = null;
    isAddingNewStrategy = false; // Reset flag if user cancels
}

function confirmColumnMapping() {
    confirmColumnMappingWithSheets();
}

function processTradesWithMapping(jsonData, mapping) {
    const allTradesData = [];
    let skippedRows = 0;
    
    // Skip header row
    for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        
        // Extract date
        let dateStr = row[mapping.date];
        let date = parseDate(dateStr);
        
        if (!date) {
            console.warn('Skipping row', (i + 1), '- Invalid date:', dateStr);
            skippedRows++;
            continue;
        }
        
        // Extract P&L
        let profitLoss = parseFloat(row[mapping.pl]);
        if (isNaN(profitLoss)) {
            console.warn('Skipping row', (i + 1), '- Invalid P&L');
            skippedRows++;
            continue;
        }
        
        // Extract charges (default to 0)
        let charges = mapping.charges !== null ? parseFloat(row[mapping.charges]) : 0;
        if (isNaN(charges)) charges = 0;
        
        let netPL = profitLoss - charges;
        
        // Extract optional fields
        let entryType = mapping.entryType !== null ? row[mapping.entryType] : '';
        let exitCriteria = mapping.exitCriteria !== null ? row[mapping.exitCriteria] : '';
        let lotsDeltaSize = mapping.lots !== null ? row[mapping.lots] : '';
        
        allTradesData.push({
            date: date,
            dateStr: dateStr,
            entryType: entryType || '',
            exitCriteria: exitCriteria || '',
            grossPL: profitLoss,
            charges: charges,
            netPL: netPL,
            lotsDeltaSize: lotsDeltaSize || ''
        });
    }
    
    allTradesData.sort((a, b) => a.date - b.date);
    
    console.log('✅ Processed', allTradesData.length, 'trades');
    if (skippedRows > 0) {
        console.log('⚠️ Skipped', skippedRows, 'rows');
    }
    
    return allTradesData;
}

function parseDate(dateStr) {
    if (!dateStr) return null;
    
    if (dateStr instanceof Date) {
        return isNaN(dateStr.getTime()) ? null : dateStr;
    }
    
    dateStr = String(dateStr).trim();
    
    if (!dateStr || dateStr === '' || dateStr === 'undefined' || dateStr === 'null') {
        return null;
    }
    
    const numValue = parseFloat(dateStr);
    if (!isNaN(numValue) && numValue > 40000 && numValue < 60000) {
        const excelEpoch = new Date(1899, 11, 30);
        const jsDate = new Date(excelEpoch.getTime() + numValue * 24 * 60 * 60 * 1000);
        return jsDate;
    }
    
    let parts = dateStr.split('-');
    if (parts.length === 3) {
        const day = parseInt(parts[0]);
        const month = parseInt(parts[1]) - 1;
        const year = parseInt(parts[2]);
        
        if (!isNaN(day) && !isNaN(month) && !isNaN(year) && day > 0 && day <= 31 && month >= 0 && month <= 11 && year > 1900) {
            return new Date(year, month, day);
        }
    }
    
    parts = dateStr.split('/');
    if (parts.length === 3) {
        const day = parseInt(parts[0]);
        const month = parseInt(parts[1]) - 1;
        const year = parseInt(parts[2]);
        
        if (!isNaN(day) && !isNaN(month) && !isNaN(year) && day > 0 && day <= 31 && month >= 0 && month <= 11 && year > 1900) {
            return new Date(year, month, day);
        }
    }
    
    parts = dateStr.split('-');
    if (parts.length === 3 && parts[0].length === 4) {
        const year = parseInt(parts[0]);
        const month = parseInt(parts[1]) - 1;
        const day = parseInt(parts[2]);
        
        if (!isNaN(day) && !isNaN(month) && !isNaN(year) && day > 0 && day <= 31 && month >= 0 && month <= 11 && year > 1900) {
            return new Date(year, month, day);
        }
    }
    
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
        return date;
    }
    
    return null;
}

// ========== EXPORT / IMPORT STRATEGIES ==========

function exportStrategies() {
    if (strategies.length === 0) {
        showError('No strategies to export');
        return;
    }
    
    const exportData = {
        version: '1.3',
        exportDate: new Date().toISOString(),
        strategies: strategies
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'trading_strategies_' + new Date().toISOString().split('T')[0] + '.json';
    a.click();
    URL.revokeObjectURL(url);
    
    console.log('✅ Exported', strategies.length, 'strategies');
}

function importStrategies(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    
    reader.onload = function(e) {
        try {
            const importData = JSON.parse(e.target.result);
            
            if (!importData.strategies || !Array.isArray(importData.strategies)) {
                showError('Invalid import file format');
                return;
            }
            
            // Ask user: Replace or Merge
            const choice = confirm('Click OK to REPLACE all strategies, or Cancel to MERGE with existing strategies.');
            
            if (choice) {
                // Replace all
                strategies = importData.strategies;
                currentStrategyId = strategies.length > 0 ? strategies[0].id : null;
            } else {
                // Merge - add imported strategies
                importData.strategies.forEach(importedStrategy => {
                    // Check if we're at limit
                    if (strategies.length >= 10) {
                        console.warn('Skipping strategy - limit reached:', importedStrategy.name);
                        return;
                    }
                    
                    // Generate new ID to avoid conflicts
                    importedStrategy.id = 'strategy_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                    strategies.push(importedStrategy);
                });
                
                if (!currentStrategyId && strategies.length > 0) {
                    currentStrategyId = strategies[0].id;
                }
            }
            
            // Convert date strings back to Date objects
            strategies.forEach(strategy => {
                strategy.allTradesData.forEach(trade => {
                    trade.date = new Date(trade.date);
                });
                if (strategy.tradesData) {
                    strategy.tradesData.forEach(trade => {
                        trade.date = new Date(trade.date);
                    });
                }
            });
            
            saveStrategiesToStorage();
            
            if (strategies.length > 0) {
                showStrategyBar();
                renderStrategyTabs();
                switchToStrategy(currentStrategyId);
            } else {
                showInitialUploadState();
                hideAllDashboardSections();
            }
            
            console.log('✅ Imported strategies. Total:', strategies.length);
            
        } catch (error) {
            showError('Error importing file: ' + error.message);
            console.error('Import error:', error);
        }
    };
    
    reader.readAsText(file);
    event.target.value = '';
}

// ========== GOOGLE SHEETS INTEGRATION ==========

let currentAuthToken = null;
let isConnectingToSheets = false;

// Setup Google Sheets event listeners
function setupSheetsEventListeners() {
    const connectBtn = document.getElementById('connectSheetsBtn');
    const authBtn = document.getElementById('authenticateGoogle');
    const testBtn = document.getElementById('testConnection');
    const confirmBtn = document.getElementById('confirmSheets');
    const cancelBtn = document.getElementById('cancelSheets');
    const refreshBtn = document.getElementById('refreshSheetData');
    
    // Use onclick instead of addEventListener to prevent duplicates
    if (connectBtn) connectBtn.onclick = openSheetsConnection;
    if (authBtn) authBtn.onclick = authenticateWithGoogle;
    if (testBtn) testBtn.onclick = testSheetConnection;
    if (confirmBtn) confirmBtn.onclick = confirmSheetConnection;
    if (cancelBtn) cancelBtn.onclick = closeSheetsModal;
    if (refreshBtn) refreshBtn.onclick = refreshCurrentStrategyData;
}



function openSheetsConnection() {
    isConnectingToSheets = true;
    
    // Show modal
    const modal = document.getElementById('sheetsModal');
    if (modal) {
        modal.style.display = 'flex';
    }
    
    // Reset ALL modal state
    document.getElementById('sheetsError').style.display = 'none';
    document.getElementById('authStatus').style.display = 'none';
    document.getElementById('sheetConfigStep').style.display = 'none';
    
    // RESET TEST CONNECTION BUTTON
    const testBtn = document.getElementById('testConnection');
    if (testBtn) {
        testBtn.style.display = 'none';
        testBtn.disabled = false;
        testBtn.innerHTML = '🔄 Test Connection';
    }
    
    // RESET CONNECT SHEET BUTTON
    const confirmBtn = document.getElementById('confirmSheets');
    if (confirmBtn) {
        confirmBtn.style.display = 'none';
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = 'Connect Sheet';
    }
    
    // Reset authentication button
    const authBtn = document.getElementById('authenticateGoogle');
    if (authBtn) {
        authBtn.disabled = false;
        authBtn.innerHTML = '🔐 Sign in with Google';
        authBtn.style.background = '';
        authBtn.style.borderColor = '';
    }
    
    // Clear or pre-fill form fields
    const strategy = getStrategy(currentStrategyId);
    if (strategy && strategy.source && strategy.source.type === 'sheets') {
        // Pre-fill existing connection
        document.getElementById('spreadsheetId').value = strategy.source.config.spreadsheetId || '';
        document.getElementById('sheetName').value = strategy.source.config.sheetName || '';
        document.getElementById('cellRange').value = strategy.source.config.range || '';
    } else {
        // Clear fields for new connection
        document.getElementById('spreadsheetId').value = '';
        document.getElementById('sheetName').value = '';
        document.getElementById('cellRange').value = '';
    }
    
    console.log('✅ Sheets modal opened with clean state');
}


function closeSheetsModal() {
    const modal = document.getElementById('sheetsModal');
    if (modal) {
        modal.style.display = 'none';
    }
    isConnectingToSheets = false;
    // Don't reset token here - keep it for re-use in same session
    console.log('✅ Sheets modal closed');
}



function authenticateWithGoogle() {
    const btn = document.getElementById('authenticateGoogle');
    btn.disabled = true;
    btn.innerHTML = '🔄 Authenticating...';
    
    bgSend({ action: 'getAuthToken', interactive: true }).then((response) => {
        if (response.success) {
            currentAuthToken = response.token;
            console.log('✅ Authentication successful, token received');
            
            // Update button immediately
            btn.innerHTML = '✅ Authenticated';
            btn.disabled = true;
            btn.style.background = '#48bb78';
            btn.style.borderColor = '#48bb78';
            
            // Hide auth status message
            const authStatus = document.getElementById('authStatus');
            if (authStatus) {
                authStatus.style.display = 'none';
            }
            
            // CRITICAL FIX: Use setTimeout to ensure DOM is ready
            setTimeout(() => {
                // Show Step 2 configuration
                const configStep = document.getElementById('sheetConfigStep');
                const testBtn = document.getElementById('testConnection');
                
                if (configStep) {
                    // Force display with multiple methods
                    configStep.style.display = 'block';
                    configStep.style.visibility = 'visible';
                    configStep.style.opacity = '1';
                    console.log('✅ Step 2 should now be visible');
                } else {
                    console.error('❌ sheetConfigStep element not found in DOM!');
                }
                
                if (testBtn) {
                    testBtn.style.display = 'inline-block';
                    console.log('✅ Test button shown');
                }
            }, 100); // Small delay ensures DOM is ready
            
        } else {
            // Show error
            console.error('❌ Authentication failed:', response.error);
            const authStatus = document.getElementById('authStatus');
            if (authStatus) {
                authStatus.textContent = '❌ Authentication failed: ' + response.error;
                authStatus.style.display = 'block';
                authStatus.style.background = 'rgba(245, 101, 101, 0.2)';
                authStatus.style.color = '#f56565';
                authStatus.style.padding = '10px';
                authStatus.style.borderRadius = '6px';
            }
            btn.disabled = false;
            btn.innerHTML = '🔐 Sign in with Google';
            btn.style.background = '';
            btn.style.borderColor = '';
        }
    });
}


function testSheetConnection() {
    const spreadsheetId = document.getElementById('spreadsheetId').value.trim();
    const sheetName = document.getElementById('sheetName').value.trim();
    const cellRange = document.getElementById('cellRange').value.trim();
    
    const errorDiv = document.getElementById('sheetsError');
    
    if (!spreadsheetId || !sheetName || !cellRange) {
        errorDiv.textContent = '⚠️ Please fill in all fields';
        errorDiv.style.display = 'block';
        errorDiv.style.background = 'rgba(237, 137, 54, 0.2)';
        errorDiv.style.color = '#ed8936';
        return;
    }
    
    const range = `${sheetName}!${cellRange}`;
    const btn = document.getElementById('testConnection');
    
    btn.disabled = true;
    btn.innerHTML = '🔄 Testing...';
    
    bgSend({ action: 'fetchSheetData', token: currentAuthToken, spreadsheetId: spreadsheetId, range: range }).then((response) => {
        if (response.success) {
            const rowCount = response.data.length;
            
            // Show success message
            errorDiv.textContent = `✅ Connection successful! Found ${rowCount} rows.`;
            errorDiv.style.display = 'block';
            errorDiv.style.background = 'rgba(72, 187, 120, 0.2)';
            errorDiv.style.color = '#48bb78';
            errorDiv.style.padding = '12px';
            errorDiv.style.borderRadius = '8px';
            errorDiv.style.fontWeight = '600';
            
            // Update test button
            btn.innerHTML = '✅ Test Passed';
            btn.disabled = true;
            btn.style.background = '#48bb78';
            btn.style.borderColor = '#48bb78';
            
            // CRITICAL: Show the Connect Sheet button
            const confirmBtn = document.getElementById('confirmSheets');
            if (confirmBtn) {
                confirmBtn.style.display = 'inline-block';
                confirmBtn.disabled = false;
                confirmBtn.innerHTML = 'Connect Sheet';
                console.log('✅ Connect Sheet button shown');
            } else {
                console.error('❌ confirmSheets button not found!');
            }
            
        } else {
            // Show error
            errorDiv.textContent = '❌ Connection failed: ' + response.error;
            errorDiv.style.display = 'block';
            errorDiv.style.background = 'rgba(245, 101, 101, 0.2)';
            errorDiv.style.color = '#f56565';
            errorDiv.style.padding = '12px';
            errorDiv.style.borderRadius = '8px';
            errorDiv.style.fontWeight = '600';
            
            // Reset test button to allow retry
            btn.disabled = false;
            btn.innerHTML = '🔄 Test Connection';
            btn.style.background = '';
            btn.style.borderColor = '';
            
            // Hide connect button on error
            const confirmBtn = document.getElementById('confirmSheets');
            if (confirmBtn) {
                confirmBtn.style.display = 'none';
            }
        }
    });
}


function confirmSheetConnection() {
    const spreadsheetId = document.getElementById('spreadsheetId').value.trim();
    const sheetName = document.getElementById('sheetName').value.trim();
    const cellRange = document.getElementById('cellRange').value.trim();
    const range = `${sheetName}!${cellRange}`;
    
    const btn = document.getElementById('confirmSheets');
    btn.disabled = true;
    btn.innerHTML = '🔄 Fetching data...';
    
    chrome.runtime.sendMessage({
        action: 'fetchSheetData',
        token: currentAuthToken,
        spreadsheetId: spreadsheetId,
        range: range
    }, (response) => {
        if (response.success) {
            // Store pending data for column mapping
            pendingFileData = {
                fileName: `${sheetName} (Google Sheets)`,
                jsonData: response.data
            };
            
            // Close sheets modal
            closeSheetsModal();
            
            // Get existing mapping if strategy exists
            let existingMapping = null;
            if (currentStrategyId) {
                const strategy = getStrategy(currentStrategyId);
                if (strategy && strategy.columnMapping) {
                    existingMapping = strategy.columnMapping;
                }
            }
            
            // Show column mapping modal
            showColumnMappingModal(response.data, existingMapping);
            
            // Store sheets config temporarily for later use
            window.pendingSheetsConfig = {
                spreadsheetId: spreadsheetId,
                sheetName: sheetName,
                range: cellRange,
                fullRange: range
            };
            
        } else {
            // Show error
            document.getElementById('sheetsError').textContent = '❌ Failed to fetch data: ' + response.error;
            document.getElementById('sheetsError').style.display = 'block';
            btn.disabled = false;
            btn.innerHTML = 'Connect Sheet';
        }
    });
}


function refreshCurrentStrategyData() {
    if (!currentStrategyId) return;
    
    const strategy = getStrategy(currentStrategyId);
    if (!strategy.source || strategy.source.type !== 'sheets') {
        showError('This strategy is not connected to Google Sheets');
        return;
    }
    
    const btn = document.getElementById('refreshSheetData');
    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⏳ Refreshing...';
    
    bgSend({ action: 'getAuthToken', interactive: false }).then((authResponse) => {
        if (!authResponse.success) {
            return bgSend({ action: 'getAuthToken', interactive: true });
        }
        return authResponse;
    }).then((response) => {
        if (!response || !response.success) {
            showError('Authentication failed. Please try reconnecting.');
            btn.disabled = false;
            btn.innerHTML = originalHTML;
            return;
        }
        fetchAndUpdateSheetData(response.token, strategy, btn, originalHTML);
    });
}

function fetchAndUpdateSheetData(token, strategy, btn, originalHTML) {
    const config = strategy.source.config;
    
    chrome.runtime.sendMessage({
        action: 'fetchSheetData',
        token: token,
        spreadsheetId: config.spreadsheetId,
        range: config.fullRange
    }, (response) => {
        if (response.success) {
            const allTradesData = processTradesWithMapping(response.data, strategy.columnMapping);
            
            if (allTradesData.length === 0) {
                showError('No valid trades found in the sheet');
                btn.disabled = false;
                btn.innerHTML = originalHTML;
                return;
            }
            
            strategy.allTradesData = allTradesData;
            strategy.tradesData = [...allTradesData];
            strategy.selectedYear = 'ALL';
            strategy.selectedMonth = null;
            strategy.lastUpdated = new Date().toISOString();
            strategy.source.config.lastSync = new Date().toISOString();
            
            saveStrategiesToStorage();
            
            document.getElementById('lastUpdated').textContent = formatLastUpdated(strategy.lastUpdated);
            
            applyFiltersAndUpdate();
            
            btn.disabled = false;
            btn.innerHTML = originalHTML;
            
            const originalColor = btn.style.background;
            btn.style.background = '#48bb78';
            btn.innerHTML = '✓ Refreshed!';
            setTimeout(() => {
                btn.innerHTML = originalHTML;
                btn.style.background = originalColor;
            }, 2000);
            
            console.log('Sheet data refreshed:', allTradesData.length, 'trades');
        } else {
            showError('Failed to refresh: ' + response.error);
            btn.disabled = false;
            btn.innerHTML = originalHTML;
        }
    });
}


// Update confirmColumnMapping to handle sheets
function confirmColumnMappingWithSheets() {
    // Safety check: Ensure pendingFileData exists
    if (!pendingFileData || !pendingFileData.jsonData) {
        document.getElementById('mappingError').textContent = 'Error: No data found. Please try reconnecting.';
        document.getElementById('mappingError').style.display = 'block';
        console.error('pendingFileData is missing:', pendingFileData);
        return;
    }
    
    const dateCol = document.getElementById('dateColumn').value;
    const plCol = document.getElementById('plColumn').value;
    const chargesCol = document.getElementById('chargesColumn').value;
    const lotsCol = document.getElementById('lotsColumn').value;
    const entryTypeCol = document.getElementById('entryTypeColumn').value;
    const exitCriteriaCol = document.getElementById('exitCriteriaColumn').value;
    
    if (!dateCol || !plCol) {
        document.getElementById('mappingError').textContent = 'Please select Date and Profit/Loss columns';
        document.getElementById('mappingError').style.display = 'block';
        return;
    }
    
    const columnMapping = {
        date: parseInt(dateCol),
        pl: parseInt(plCol),
        charges: chargesCol ? parseInt(chargesCol) : null,
        lots: lotsCol ? parseInt(lotsCol) : null,
        entryType: entryTypeCol ? parseInt(entryTypeCol) : null,
        exitCriteria: exitCriteriaCol ? parseInt(exitCriteriaCol) : null
    };
    
    const allTradesData = processTradesWithMapping(pendingFileData.jsonData, columnMapping);
    
    if (allTradesData.length === 0) {
        document.getElementById('mappingError').textContent = 'No valid trades found with this mapping';
        document.getElementById('mappingError').style.display = 'block';
        return;
    }
    
    // Close mapping modal
    document.getElementById('mappingModal').style.display = 'none';
    document.getElementById('mappingError').style.display = 'none';
    
    // Check if this is a sheets connection
    const isSheets = window.pendingSheetsConfig !== undefined;
    
    console.log('✅ Mapping confirmed. isAddingNewStrategy:', isAddingNewStrategy, 'isSheets:', isSheets);
    
    if (isAddingNewStrategy) {
        // ADDING NEW STRATEGY
        const defaultName = 'Strategy ' + (strategies.length + 1);
        const name = prompt('Enter strategy name (max 20 characters):', defaultName);
        
        if (!name || !name.trim()) {
            // User cancelled - clean up
            console.log('⚠️ User cancelled strategy creation');
            pendingFileData = null;
            isAddingNewStrategy = false;
            window.pendingSheetsConfig = undefined;
            return;
        }
        
        // Create new strategy
        const strategy = createStrategy(
            name.trim().substring(0, 20),
            pendingFileData.fileName,
            columnMapping,
            allTradesData
        );
        
        if (isSheets) {
            // Update strategy with sheets configuration
            strategy.source = {
                type: 'sheets',
                config: {
                    ...window.pendingSheetsConfig,
                    lastSync: new Date().toISOString()
                }
            };
            saveStrategiesToStorage();
            updateUIForSheetsSource(strategy.id);
            console.log('✅ New Google Sheets strategy created:', strategy.name);
        } else {
            console.log('✅ New file strategy created:', strategy.name);
        }
        
        isAddingNewStrategy = false;
        
    } else if (currentStrategyId) {
        // UPDATING EXISTING STRATEGY
        const strategy = getStrategy(currentStrategyId);
        strategy.fileName = pendingFileData.fileName;
        strategy.lastUpdated = new Date().toISOString();
        strategy.columnMapping = columnMapping;
        strategy.allTradesData = allTradesData;
        strategy.tradesData = [...allTradesData];
        strategy.selectedYear = 'ALL';
        strategy.selectedMonth = null;
        
        if (isSheets) {
            strategy.source = {
                type: 'sheets',
                config: {
                    ...window.pendingSheetsConfig,
                    lastSync: new Date().toISOString()
                }
            };
            updateUIForSheetsSource(strategy.id);
            console.log('✅ Strategy updated with Google Sheets:', strategy.name);
        } else {
            strategy.source = {
                type: 'file',
                config: {}
            };
            console.log('✅ Strategy updated with file:', strategy.name);
        }
        
        saveStrategiesToStorage();
        switchToStrategy(currentStrategyId);
        
    } else {
        // NO CURRENT STRATEGY AND NOT ADDING NEW (edge case)
        const defaultName = 'Strategy 1';
        const name = prompt('Enter strategy name (max 20 characters):', defaultName);
        
        if (!name || !name.trim()) {
            pendingFileData = null;
            window.pendingSheetsConfig = undefined;
            return;
        }
        
        const strategy = createStrategy(
            name.trim().substring(0, 20),
            pendingFileData.fileName,
            columnMapping,
            allTradesData
        );
        
        if (isSheets) {
            strategy.source = {
                type: 'sheets',
                config: {
                    ...window.pendingSheetsConfig,
                    lastSync: new Date().toISOString()
                }
            };
            saveStrategiesToStorage();
            updateUIForSheetsSource(strategy.id);
        }
    }
    
    // Clean up temporary data
    pendingFileData = null;
    window.pendingSheetsConfig = undefined;
    
    console.log('✅ Strategy creation/update complete!');
}


function updateUIForSheetsSource(strategyId) {
    const strategy = getStrategy(strategyId);
    if (strategy && strategy.source && strategy.source.type === 'sheets') {
        document.getElementById('sheetSourceInfo').style.display = 'flex';
        document.getElementById('sheetSource').textContent = '📊 Google Sheets';
        document.getElementById('refreshSheetData').style.display = 'inline-block';
    } else {
        document.getElementById('sheetSourceInfo').style.display = 'none';
        document.getElementById('refreshSheetData').style.display = 'none';
    }
}

// ========== END GOOGLE SHEETS INTEGRATION ==========


// ========== STRATEGY COMPARISON ==========

function openCompareStrategies() {
    if (strategies.length < 2) {
        showError('Need at least 2 strategies to compare');
        return;
    }
    
    document.getElementById('compareSection').style.display = 'block';
    
    // Render checkboxes
    renderComparisonCheckboxes();
    
    // Initialize week range controls
    initializeWeekRangeSlider();
    
    // Render comparison
    updateComparison();
}

// ========== WEEK RANGE SLIDER ==========

let currentWeekRange = { start: 1, end: null }; // null = show all

function initializeWeekRangeSlider() {
    // Find max weeks across all strategies
    const maxWeeks = Math.max(...strategies.map(s => {
        const weeklyData = aggregateToWeekly(s.allTradesData, 'NET');
        return weeklyData.data.length;
    }));
    
    if (maxWeeks <= 20) {
        // Don't show slider if all strategies are short
        document.getElementById('weekRangeControls').style.display = 'none';
        currentWeekRange = { start: 1, end: null };
        return;
    }
    
    // Show slider
    document.getElementById('weekRangeControls').style.display = 'block';
    
    // Set slider max values
    document.getElementById('startWeekSlider').max = maxWeeks;
    document.getElementById('endWeekSlider').max = maxWeeks;
    
    // Initialize to show all weeks
    currentWeekRange = { start: 1, end: maxWeeks };
    document.getElementById('startWeekSlider').value = 1;
    document.getElementById('endWeekSlider').value = maxWeeks;
    
    updateWeekRangeDisplay();
    updateSliderTrackFill(); // Initialize track fill

    // Attach event listeners
    document.getElementById('startWeekSlider').addEventListener('input', handleWeekRangeChange);
    document.getElementById('endWeekSlider').addEventListener('input', handleWeekRangeChange);
    document.getElementById('resetWeekRange').addEventListener('click', resetWeekRange);
}

function handleWeekRangeChange() {
    let startWeek = parseInt(document.getElementById('startWeekSlider').value);
    let endWeek = parseInt(document.getElementById('endWeekSlider').value);
    
    // Ensure start < end (swap if needed)
    if (startWeek >= endWeek) {
        if (this.id === 'startWeekSlider') {
            endWeek = startWeek + 1;
            document.getElementById('endWeekSlider').value = endWeek;
        } else {
            startWeek = endWeek - 1;
            document.getElementById('startWeekSlider').value = startWeek;
        }
    }
    
    currentWeekRange = { start: startWeek, end: endWeek };
    updateWeekRangeDisplay();
    updateSliderTrackFill(); // NEW: Update visual track
    updateComparison(); // Redraw chart with new range
}


function updateWeekRangeDisplay() {
    const display = `Week ${currentWeekRange.start} - Week ${currentWeekRange.end}`;
    document.getElementById('weekRangeDisplay').textContent = display;
    document.getElementById('startWeekLabel').textContent = `Start: Week ${currentWeekRange.start}`;
    document.getElementById('endWeekLabel').textContent = `End: Week ${currentWeekRange.end}`;
}

function updateSliderTrackFill() {
    const slider = document.getElementById('startWeekSlider');
    const maxWeeks = parseInt(slider.max);
    const startWeek = currentWeekRange.start;
    const endWeek = currentWeekRange.end;
    
    // Calculate percentages
    const startPercent = ((startWeek - 1) / (maxWeeks - 1)) * 100;
    const endPercent = ((endWeek - 1) / (maxWeeks - 1)) * 100;
    
    // Update fill track
    const fill = document.getElementById('sliderTrackFill');
    fill.style.left = startPercent + '%';
    fill.style.width = (endPercent - startPercent) + '%';
}


function resetWeekRange() {
    const maxWeeks = parseInt(document.getElementById('endWeekSlider').max);
    currentWeekRange = { start: 1, end: maxWeeks };
    document.getElementById('startWeekSlider').value = 1;
    document.getElementById('endWeekSlider').value = maxWeeks;
    updateWeekRangeDisplay();
    updateSliderTrackFill(); // NEW: Update visual track
    updateComparison();
}



function closeCompareStrategies() {
    document.getElementById('compareSection').style.display = 'none';
    if (compareChart) {
        compareChart.destroy();
        compareChart = null;
    }
}

function renderComparisonCheckboxes() {
    const container = document.getElementById('strategyCheckboxes');
    container.innerHTML = '';
    
    strategies.forEach(strategy => {
        const item = document.createElement('div');
        item.className = 'strategy-checkbox-item';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = 'compare_' + strategy.id;
        checkbox.checked = true;
        checkbox.addEventListener('change', updateComparison);
        
        const label = document.createElement('label');
        label.htmlFor = 'compare_' + strategy.id;
        label.textContent = strategy.name;
        
        item.appendChild(checkbox);
        item.appendChild(label);
        container.appendChild(item);
    });
}

// ========================================
// BEST/WORST PERIOD ANALYSIS FUNCTIONS
// ========================================

// Calculate cumulative P&L for a given week range
function calculateCumulativePL(weeklyData, startWeek, endWeek) {
    // Guard against missing or invalid data
    if (!Array.isArray(weeklyData) || weeklyData.length === 0) {
        return 0;
    }

    if (startWeek < 1 || endWeek > weeklyData.length || startWeek > endWeek) {
        return 0;
    }

    let cumulative = 0;
    for (let i = startWeek - 1; i < endWeek; i++) {
        cumulative += weeklyData[i];
    }
    return cumulative;
}


// Find best and worst performing periods using sliding window
// Find best and worst performing periods using sliding window
function findBestWorstPeriods(weeklyData, windowSize) {
    // 1. Validate input first
    if (!Array.isArray(weeklyData) || weeklyData.length === 0) {
        // weeklyData is missing or empty → nothing to analyse
        return null;
    }

    // 2. If there are fewer weeks than the window size, we also stop
    if (weeklyData.length < windowSize) {
        return null;
    }

    // 3. Now we are safe to use weeklyData.length everywhere below
    let best = -Infinity;
    let worst = Infinity;
    let bestStart = 1;
    let worstStart = 1;

    // Sliding window through all possible periods
    for (let i = 0; i <= weeklyData.length - windowSize; i++) {
        const cumulative = calculateCumulativePL(weeklyData, i + 1, i + windowSize);

        if (cumulative > best) {
            best = cumulative;
            bestStart = i + 1;
        }

        if (cumulative < worst) {
            worst = cumulative;
            worstStart = i + 1;
        }
    }

    return { best, worst, bestStart, worstStart };
}


// Calculate period analysis for a strategy
// Calculate period analysis for a strategy
function calculatePeriodAnalysis(strategy, startWeek, endWeek) {
    const weeklyResult = aggregateToWeekly(strategy.allTradesData, currentPLType);
    const weeklyData = weeklyResult.data; // Get cumulative PL array
    const windowSize = endWeek - startWeek + 1;
    
    // Beginning P&L (from start to windowSize)
    const beginningPL = (windowSize <= weeklyData.length) ? weeklyData[windowSize - 1] : (weeklyData.length > 0 ? weeklyData[weeklyData.length - 1] : 0);
    
    // Current Timeline P&L (selected range)
    const currentPL = (endWeek <= weeklyData.length) ? weeklyData[endWeek - 1] - (startWeek > 1 ? weeklyData[startWeek - 2] : 0) : 0;
    
    // Best and Worst periods using sliding window
    let best = -Infinity;
    let worst = Infinity;
    let bestStart = 1;
    let worstStart = 1;
    
    if (weeklyData.length >= windowSize) {
        for (let i = 0; i <= weeklyData.length - windowSize; i++) {
            const endIdx = i + windowSize - 1;
            const periodPL = weeklyData[endIdx] - (i > 0 ? weeklyData[i - 1] : 0);
            
            if (periodPL > best) {
                best = periodPL;
                bestStart = i + 1;
            }
            if (periodPL < worst) {
                worst = periodPL;
                worstStart = i + 1;
            }
        }
    }
    
    return {
        strategyName: strategy.name,
        strategyColor: null, // Will be assigned later
        beginningPL: beginningPL || 0,
        currentPL: currentPL || 0,
        worstPL: (worst === Infinity) ? 0 : worst,
        bestPL: (best === -Infinity) ? 0 : best,
        worstStart: worstStart,
        bestStart: bestStart,
        weeklyData: weeklyData
    };
}


function updateComparison() {
    const selectedStrategies = strategies.filter(s => {
        const checkbox = document.getElementById('compare_' + s.id);
        return checkbox && checkbox.checked;
    });
    
    if (selectedStrategies.length === 0) {
        showError('Select at least one strategy to compare');
        return;
    }
    
    // Get current week range
    const startWeek = currentWeekRange.start;
    const endWeek = currentWeekRange.end || Math.max(...selectedStrategies.map(s => {
        const weeklyData = aggregateToWeekly(s.allTradesData, 'NET');
        return weeklyData.data.length;
    }));
    
    // Create existing charts and table
    createComparisonChart(selectedStrategies);
    createComparisonTable(selectedStrategies);
    
    // Calculate period analysis for all selected strategies
    const periodData = selectedStrategies.map((strategy, index) => {
        const analysis = calculatePeriodAnalysis(strategy, startWeek, endWeek);
        const colors = ['#667eea', '#48bb78', '#f6ad55', '#ed64a6', '#4299e1', '#9f7aea', '#38b2ac', '#ed8936', '#e53e3e', '#805ad5'];
        analysis.strategyColor = colors[index % colors.length];
        return analysis;
    });
    
    // Create dumbbell chart and detail table
    createDumbbellChart(periodData);
    createDetailTable(periodData);
    
    // Update period weeks display
    const weekCount = endWeek - startWeek + 1;
    const weekCountElement = document.getElementById('weekCount');
    const periodWeeksElement = document.getElementById('periodWeeksDisplay');
    
    if (weekCountElement) {
        weekCountElement.textContent = weekCount;
    }
    
    if (periodWeeksElement) {
        periodWeeksElement.textContent = `${weekCount} weeks`;
    }
}


function createComparisonChart(selectedStrategies) {
    if (compareChart) {
        compareChart.destroy();
        compareChart = null;
    }
    
    const ctx = document.getElementById('compareChart');
    
    // Get weekly data for each strategy
    const datasets = [];
    const colors = ['#667eea', '#48bb78', '#f6ad55', '#ed64a6', '#4299e1', '#9f7aea', '#38b2ac', '#ed8936', '#e53e3e', '#805ad5'];
    
selectedStrategies.forEach((strategy, index) => {
    const weeklyData = aggregateToWeekly(strategy.allTradesData, currentPLType);
    
    // Apply week range filter
    let filteredData = weeklyData.data;
    if (currentWeekRange.end !== null) {
        const startIdx = currentWeekRange.start - 1;
        const endIdx = currentWeekRange.end;
        filteredData = weeklyData.data.slice(startIdx, endIdx);
    }
    
    datasets.push({
        label: strategy.name,
        data: filteredData,
        borderColor: colors[index % colors.length],
        backgroundColor: colors[index % colors.length] + '33',
        borderWidth: 3,
        fill: false,
        tension: 0.3,
        pointRadius: 2,
        pointHoverRadius: 5
    });
});

// Create labels based on week range
const allLabels = datasets.map(d => d.data.length);
const maxLength = Math.max(...allLabels);
const labels = [];
for (let i = 0; i < maxLength; i++) {
    labels.push('Week ' + (currentWeekRange.start + i));
}

    
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim();
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)';
    
    compareChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index',
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: textColor,
                        font: { size: 12 },
                        usePointStyle: true
                    }
                },
                tooltip: {
                    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.9)' : 'rgba(0, 0, 0, 0.8)',
                    titleColor: isDark ? '#1a202c' : '#ffffff',
                    bodyColor: isDark ? '#1a202c' : '#ffffff',
                    padding: 10,
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': ' + formatCurrency(context.parsed.y);
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    grid: { color: gridColor },
                    ticks: {
                        color: textColor,
                        callback: function(value) {
                            return '₹' + (value / 1000).toFixed(0) + 'K';
                        }
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: {
                        color: textColor,
                        maxTicksLimit: 10
                    }
                }
            }
        }
    });
}

function aggregateToWeekly(tradesData, plType) {
    if (tradesData.length === 0) return { data: [], weekTrades: [] };
    
    const weeklyData = [];
    const weekTrades = []; // NEW: Track which trades belong to which week
    let cumulativePL = 0;
    let currentWeekStart = new Date(tradesData[0].date);
    currentWeekStart.setDate(currentWeekStart.getDate() - currentWeekStart.getDay()); // Start of week (Sunday)
    
    let weekPL = 0;
    let currentWeekTradeList = []; // NEW: Trades in current week
    
    tradesData.forEach(trade => {
        const plValue = plType === 'GROSS' ? trade.grossPL : trade.netPL;
        
        // Check if trade is in current week
        const tradeWeekStart = new Date(trade.date);
        tradeWeekStart.setDate(tradeWeekStart.getDate() - tradeWeekStart.getDay());
        
        if (tradeWeekStart.getTime() > currentWeekStart.getTime()) {
            // New week - record previous week
            cumulativePL += weekPL;
            weeklyData.push(cumulativePL);
            weekTrades.push(currentWeekTradeList); // NEW: Save week's trades
            
            // Move to next week
            currentWeekStart = tradeWeekStart;
            weekPL = plValue;
            currentWeekTradeList = [trade]; // NEW: Start new week list
        } else {
            weekPL += plValue;
            currentWeekTradeList.push(trade); // NEW: Add to current week
        }
    });
    
    // Add final week
    cumulativePL += weekPL;
    weeklyData.push(cumulativePL);
    weekTrades.push(currentWeekTradeList); // NEW: Save final week's trades
    
    return { data: weeklyData, weekTrades: weekTrades }; // NEW: Return both
}

function createComparisonTable(selectedStrategies) {
    const table = document.getElementById('compareTable');
    
    // Clear existing content
    table.innerHTML = '';
    
    // Create header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headerRow.innerHTML = '<th>Metric</th>';
    selectedStrategies.forEach(strategy => {
        const th = document.createElement('th');
        th.textContent = strategy.name;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    // Calculate metrics for each strategy
    const metricsData = selectedStrategies.map(strategy => calculateComparisonMetrics(strategy));
    
    // Define metrics to compare
    const metrics = [
        { name: 'Net P&L', key: 'netPL', format: formatCurrency, higherBetter: true },
        { name: 'Trades', key: 'trades', format: v => v, higherBetter: null },
        { name: 'Profitability', key: 'profitability', format: v => v.toFixed(2) + '%', higherBetter: true },
        { name: 'Profit Factor', key: 'profitFactor', format: v => v === Infinity ? '∞' : v.toFixed(2), higherBetter: true },
        { name: 'Avg Return/Trade', key: 'avgReturn', format: formatCurrency, higherBetter: true },
        { name: 'Max Drawdown', key: 'maxDD', format: formatCurrency, higherBetter: false },
        { name: 'Total Charges', key: 'totalCharges', format: formatCurrency, higherBetter: false }
    ];
    
    // Create body
    const tbody = document.createElement('tbody');
    
    metrics.forEach(metric => {
        const row = document.createElement('tr');
        
        const metricCell = document.createElement('td');
        metricCell.className = 'metric-name';
        metricCell.textContent = metric.name;
        row.appendChild(metricCell);
        
        // Find best value
        const values = metricsData.map(m => m[metric.key]);
        let bestIndex = -1;
        
        if (metric.higherBetter === true) {
            const maxValue = Math.max(...values.filter(v => v !== Infinity));
            bestIndex = values.findIndex(v => v === maxValue);
        } else if (metric.higherBetter === false) {
            const minValue = Math.min(...values);
            bestIndex = values.findIndex(v => v === minValue);
        }
        
        // Add value cells
        metricsData.forEach((data, index) => {
            const cell = document.createElement('td');
            cell.textContent = metric.format(data[metric.key]);
            if (index === bestIndex) {
                cell.classList.add('best-value');
            }
            row.appendChild(cell);
        });
        
        tbody.appendChild(row);
    });
    
    table.appendChild(tbody);
}

// Create dumbbell chart for best/worst period comparison
function createDumbbellChart(periodData) {
    // Destroy existing chart
    if (dumbbellChart) {
        dumbbellChart.destroy();
        dumbbellChart = null;
    }
    
    const chartElement = document.querySelector('#dumbbellChart');
    if (!chartElement) {
        console.error('Canvas element #dumbbellChart not found');
        return;
    }
    
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim();
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)';
    
    // Helpers
    function darkenHex(hex, percent) {
        // hex may be in #RRGGBB form
        const h = hex.replace('#', '');
        const r = parseInt(h.substring(0,2), 16);
        const g = parseInt(h.substring(2,4), 16);
        const b = parseInt(h.substring(4,6), 16);
        const p = Math.max(-100, Math.min(100, percent));
        const t = p < 0 ? 0 : 255;
        const absP = Math.abs(p) / 100;
        const newR = Math.round((t - r) * absP + r);
        const newG = Math.round((t - g) * absP + g);
        const newB = Math.round((t - b) * absP + b);
        return `#${newR.toString(16).padStart(2,'0')}${newG.toString(16).padStart(2,'0')}${newB.toString(16).padStart(2,'0')}`;
    }

    function formatRupeeShort(v) {
        if (v === null || v === undefined) return '';
        const n = Number(v);
        const abs = Math.abs(n);
        let out;
        if (abs >= 1e6) {
            out = (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
        } else if (abs >= 1e3) {
            out = (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
        } else {
            out = Math.round(n).toString();
        }
        return '₹' + out;
    }

    const strategyNames = periodData.map(d => d.strategyName);
    let hoverIdx = -1; // index of currently hovered strategy column, -1 = none
    // Create one series per strategy so each dumbbell uses its own color
    const rangeSeries = periodData.map(d => ({
        name: d.strategyName,
        data: [{ x: d.strategyName, y: [d.worstPL, d.bestPL] }]
    }));

    // We do not plot current points as visible scatter series to keep clean dumbbell look.
    // The current value remains available in the tooltip via `periodData` lookup.
    const series = rangeSeries;
    
    const options = {
        series: series,
        chart: {
            type: 'rangeBar',
            height: Math.max(300, periodData.length * 60),
            background: 'transparent',
            toolbar: { show: false },
            animations: { enabled: true, speed: 800 },
            offsetY: 8
        },
        plotOptions: {
            bar: {
                horizontal: false,
                columnWidth: '18%',
                rangeBarGroupRows: false,
                isDumbbell: true,
                // endpoints use slightly darker shade (per-series)
                dumbbellColors: periodData.map(d => [darkenHex(d.strategyColor, -25), darkenHex(d.strategyColor, -25)])
            }
        },
        // Colors for the series (range series will pick these)
        colors: periodData.map(d => d.strategyColor),
        dataLabels: {
            enabled: false
        },
        grid: {
            borderColor: gridColor,
            strokeDashArray: 4,
            xaxis: { lines: { show: true } },
            yaxis: { lines: { show: false } },
            padding: { bottom: 0 }
        },
        xaxis: {
            categories: strategyNames,
            labels: {
                show: false,
                style: { colors: textColor, fontSize: '12px' },
                rotate: -45
            },
            axisBorder: { color: gridColor },
            axisTicks: { color: gridColor }
        },
        yaxis: {
            labels: {
                style: { colors: textColor, fontSize: '11px' },
                formatter: function(val) {
                    return formatRupeeShort(val);
                }
            }
        },
        // Disable Apex native tooltip - we use an overlay-driven DOM tooltip for reliable column hover
        tooltip: { enabled: false },

        legend: {
            show: true,
            position: 'top',
            labels: { colors: textColor },
            markers: { radius: 12 }
        }
    };
    
    dumbbellChart = new ApexCharts(chartElement, options);
    dumbbellChart.render();

    // Debug Apex internals
    try {
        setTimeout(() => {
            if (dumbbellChart && dumbbellChart.w && dumbbellChart.w.globals) {
                const g = dumbbellChart.w.globals;
                console.log('Apex globals keys count:', Object.keys(g).length);
                console.log('Apex plotWidth/plotHeight/padLeft/padRight:', g.plotWidth, g.plotHeight, g.padLeft, g.padRight);
                if (g.seriesRangeStart) console.log('seriesRangeStart length:', g.seriesRangeStart.length);
            }
        }, 200);
    } catch (e) { console.log('err logging globals', e && e.message); }

    // Create an overlay of invisible columns to capture hover reliably and show custom tooltip
    (function(){
        // Delay overlay creation slightly to allow ApexCharts to finish layout
        function createOverlay() {
            try {
                // Remove any existing overlay
                const existing = chartElement.querySelector('.dumbbell-hover-overlay');
                if (existing) existing.remove();

                const chartRect = chartElement.getBoundingClientRect();
                // try to find the actual plot area inside ApexCharts to size overlay correctly
                const plotEl = chartElement.querySelector('.apexcharts-inner') || chartElement.querySelector('svg') || chartElement;
                const plotRect = plotEl.getBoundingClientRect();

                // Debug logging to help diagnose overlay misalignment
                console.log('Dumbbell overlay init - chartRect width/height:', chartRect.width, chartRect.height, 'plotRect width/height:', plotRect.width, plotRect.height);

                const overlay = document.createElement('div');
                overlay.className = 'dumbbell-hover-overlay';
                overlay.style.position = 'absolute';
                overlay.style.left = (plotRect.left - chartRect.left) + 'px';
                overlay.style.top = (plotRect.top - chartRect.top) + 'px';
                overlay.style.width = plotRect.width + 'px';
                overlay.style.height = plotRect.height + 'px';
                overlay.style.pointerEvents = 'auto';
                overlay.style.display = 'flex';
                overlay.style.zIndex = '9999';

                // Tooltip element
                let tip = chartElement.querySelector('.dumbbell-custom-tooltip');
                if (!tip) {
                    tip = document.createElement('div');
                    tip.className = 'dumbbell-custom-tooltip';
                    tip.style.position = 'absolute';
                    tip.style.pointerEvents = 'none';
                    tip.style.zIndex = 9999;
                    tip.style.display = 'none';
                    tip.style.padding = '8px 10px';
                    tip.style.borderRadius = '6px';
                    tip.style.boxShadow = '0 6px 18px rgba(0,0,0,0.3)';
                    tip.style.fontSize = '13px';
                    tip.style.lineHeight = '1.2';
                    tip.style.color = textColor;
                    tip.style.background = isDark ? '#1f2937' : '#ffffff';
                    tip.style.border = '1px solid ' + gridColor;
                    chartElement.appendChild(tip);
                }

                function showTipFor(idxOrName, clientX, clientY) {
                    // Accept either an index or a strategy name to locate the matching data row
                    let d = null;
                    if (typeof idxOrName === 'number') {
                        d = periodData[idxOrName];
                    } else if (typeof idxOrName === 'string') {
                        d = periodData.find(p => p.strategyName === idxOrName);
                    }
                    if (!d) return;
                    // Populate tooltip
                    tip.innerHTML = `<div style="font-weight:700; margin-bottom:6px;">${d.strategyName}</div>\n                        <div>Worst: <span style='color:#ef4444'>${formatCurrency(d.worstPL)}</span></div>\n                        <div>Current: <span style='font-weight:700; color:${d.strategyColor}'>${formatCurrency(d.currentPL)}</span></div>\n                        <div>Best: <span style='color:#10b981'>${formatCurrency(d.bestPL)}</span></div>`;
                    const rect = chartElement.getBoundingClientRect();
                    const left = Math.min(rect.width - 10, Math.max(10, clientX - rect.left + 12));
                    const top = Math.max(8, clientY - rect.top + 12);
                    tip.style.left = left + 'px';
                    tip.style.top = top + 'px';
                    tip.style.display = 'block';
                }
                function hideTip() { tip.style.display = 'none'; }

                // create equal columns inside overlay
                strategyNames.forEach((name, idx) => {
                    const col = document.createElement('div');
                    col.className = 'dumbbell-hover-col';
                    col.dataset.idx = idx;
                    col.dataset.sname = name; // explicit strategy name for testability
                    col.style.flex = '1';
                    col.style.height = '100%';
                    col.style.background = 'transparent';
                    col.style.cursor = 'default';
                    col.addEventListener('mouseenter', (ev) => {
                        // Show tooltip for this column (use strategy name to avoid index mismatches)
                        showTipFor(name, ev.clientX, ev.clientY);
                    });
                    col.addEventListener('mousemove', (ev) => { showTipFor(name, ev.clientX, ev.clientY); });
                    col.addEventListener('mouseleave', () => { hideTip(); });
                    overlay.appendChild(col);
                });

                chartElement.style.position = chartElement.style.position || 'relative';
                chartElement.appendChild(overlay);
            } catch (e) {
                console.error('Dumbbell overlay init error:', e && e.message ? e.message : e);
            }
        }

        // create overlay after a short delay (let chart finish drawing)
        setTimeout(createOverlay, 400);
        // ensure overlay re-creates on resize
        window.addEventListener('resize', () => { setTimeout(createOverlay, 200); });
    })();
}


// Create detail comparison table
function createDetailTable(periodData) {
    const tbody = document.getElementById('detailTableBody');
    
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    periodData.forEach(data => {
        const row = document.createElement('tr');
        
        // Strategy name with color indicator
        const nameCell = document.createElement('td');
        nameCell.innerHTML = `<div style="display: flex; align-items: center; gap: 8px;">
            <span style="width: 12px; height: 12px; border-radius: 50%; background: ${data.strategyColor};"></span>
            <span>${data.strategyName}</span>
        </div>`;
        
        // Beginning P&L
        const beginningCell = document.createElement('td');
        beginningCell.textContent = formatCurrency(data.beginningPL);
        beginningCell.style.color = data.beginningPL >= 0 ? '#48bb78' : '#f56565';
        
        // Current P&L
        const currentCell = document.createElement('td');
        currentCell.textContent = formatCurrency(data.currentPL);
        currentCell.style.color = data.currentPL >= 0 ? '#48bb78' : '#f56565';
        currentCell.style.fontWeight = '600';
        
        // Worst Period
        const worstCell = document.createElement('td');
        worstCell.innerHTML = `
            <div>${formatCurrency(data.worstPL)}</div>
            <div style="font-size: 11px; color: var(--text-secondary);">Weeks ${currentWeekRange.start}-${currentWeekRange.end}</div>
        `;
        worstCell.style.color = '#f56565';
        
        // Best Period
        const bestCell = document.createElement('td');
        bestCell.innerHTML = `
            <div>${formatCurrency(data.bestPL)}</div>
            <div style="font-size: 11px; color: var(--text-secondary);">Weeks ${currentWeekRange.start}-${currentWeekRange.end}</div>
        `;
        bestCell.style.color = '#48bb78';
        
        row.appendChild(nameCell);
        row.appendChild(beginningCell);
        row.appendChild(currentCell);
        row.appendChild(worstCell);
        row.appendChild(bestCell);
        
        tbody.appendChild(row);
    });
}


function calculateComparisonMetrics(strategy) {
    const plType = 'NET'; // Always use NET for comparison
    
    // Get weekly data
    const weeklyResult = aggregateToWeekly(strategy.allTradesData, plType);
    
    // Apply week range filter to get trades in range
    let tradesData = strategy.allTradesData;
    
    if (currentWeekRange.end !== null && weeklyResult.weekTrades) {
        // Filter trades to only include those in the selected week range
        const startIdx = currentWeekRange.start - 1;
        const endIdx = currentWeekRange.end;
        
        tradesData = [];
        for (let i = startIdx; i < endIdx && i < weeklyResult.weekTrades.length; i++) {
            tradesData = tradesData.concat(weeklyResult.weekTrades[i]);
        }
    }
    
    // If no trades in range, return zeros
    if (tradesData.length === 0) {
        return {
            netPL: 0,
            trades: 0,
            profitability: 0,
            profitFactor: 0,
            avgReturn: 0,
            maxDD: 0,
            totalCharges: 0
        };
    }
    
    const totalPL = tradesData.reduce((sum, t) => sum + t.netPL, 0);
    const totalTrades = tradesData.length;
    
    const profitableTrades = tradesData.filter(t => t.netPL > 0).length;
    const profitability = totalTrades > 0 ? (profitableTrades / totalTrades) * 100 : 0;
    
    const grossProfit = tradesData.filter(t => t.netPL > 0).reduce((sum, t) => sum + t.netPL, 0);
    const grossLoss = Math.abs(tradesData.filter(t => t.netPL < 0).reduce((sum, t) => sum + t.netPL, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);
    
    const avgReturn = totalTrades > 0 ? totalPL / totalTrades : 0;
    const totalCharges = tradesData.reduce((sum, t) => sum + t.charges, 0);
    
    // Calculate max drawdown
    let maxDD = 0;
    let peak = 0;
    let cumPL = 0;
    
    tradesData.forEach(trade => {
        cumPL += trade.netPL;
        if (cumPL > peak) peak = cumPL;
        const drawdown = peak - cumPL;
        if (drawdown > maxDD) maxDD = drawdown;
    });
    
    return {
        netPL: totalPL,
        trades: totalTrades,
        profitability: profitability,
        profitFactor: profitFactor,
        avgReturn: avgReturn,
        maxDD: maxDD,
        totalCharges: totalCharges
    };
}


// ========== DASHBOARD UPDATE ==========

// ====== METRIC / STATS HELPERS ======

function calculateStatistics() {
    const strategy = getStrategy(currentStrategyId);
    if (!strategy) return;

    const totalPL = strategy.tradesData.length > 0 ? strategy.tradesData[strategy.tradesData.length - 1].cumulativePL : 0;
    const { maxDD, maxDDPercent } = calculateMaxDrawdown();
    const totalTrades = strategy.tradesData.length;

    let winningTrades = 0;
    let losingTrades = 0;

    const profitableTrades = strategy.tradesData.filter(t => {
        const plValue = currentPLType === 'GROSS' ? t.grossPL : t.netPL;
        if (plValue > 0) {
            winningTrades++;
            return true;
        } else if (plValue < 0) {
            losingTrades++;
        }
        return false;
    }).length;

    const profitability = totalTrades > 0 ? (profitableTrades / totalTrades) * 100 : 0;

    const grossProfit = strategy.tradesData.filter(t => {
        const plValue = currentPLType === 'GROSS' ? t.grossPL : t.netPL;
        return plValue > 0;
    }).reduce((sum, t) => {
        const plValue = currentPLType === 'GROSS' ? t.grossPL : t.netPL;
        return sum + plValue;
    }, 0);

    const grossLoss = Math.abs(strategy.tradesData.filter(t => {
        const plValue = currentPLType === 'GROSS' ? t.grossPL : t.netPL;
        return plValue < 0;
    }).reduce((sum, t) => {
        const plValue = currentPLType === 'GROSS' ? t.grossPL : t.netPL;
        return sum + plValue;
    }, 0));

    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);

    const avgReturn = totalTrades > 0 ? totalPL / totalTrades : 0;

    const totalCharges = strategy.tradesData.reduce((sum, t) => sum + t.charges, 0);

    const { maxWinStreak, maxLossStreak } = calculateStreaks();

    document.getElementById('statPL').textContent = formatCurrency(totalPL);
    document.getElementById('statPL').style.color = totalPL >= 0 ? '#48bb78' : '#f56565';

    document.getElementById('statProfit').textContent = profitability.toFixed(2) + '%';
    document.getElementById('statWinLoss').textContent = '[W - ' + winningTrades + ' / L - ' + losingTrades + ']';

    document.getElementById('statPF').textContent = profitFactor === Infinity ? '∞' : profitFactor.toFixed(2);
    document.getElementById('statAvgReturn').textContent = formatCurrency(avgReturn);
    document.getElementById('statAvgReturn').style.color = avgReturn >= 0 ? '#48bb78' : '#f56565';
    document.getElementById('statCharges').textContent = formatCurrency(totalCharges);

    document.getElementById('statMaxDD').textContent = formatCurrency(maxDD) + ' (' + maxDDPercent.toFixed(2) + '%)';

    document.getElementById('statMaxWinStreak').textContent =
        formatCurrency(maxWinStreak.pl) + ' (' + maxWinStreak.count + ' trades)';

    document.getElementById('statMaxLossStreak').textContent =
        formatCurrency(maxLossStreak.pl) + ' (' + maxLossStreak.count + ' trades)';
}

function calculateMaxDrawdown() {
    const strategy = getStrategy(currentStrategyId);
    if (!strategy) return { maxDD: 0, maxDDPercent: 0 };

    let maxDD = 0;
    let maxDDPercent = 0;
    let peak = 0;
    let peakCapital = strategy.capital;

    for (let trade of strategy.tradesData) {
        const cumPL = trade.cumulativePL;
        const currentCapital = strategy.capital + cumPL;

        if (cumPL > peak) {
            peak = cumPL;
            peakCapital = currentCapital;
        }

        const drawdown = peak - cumPL;
        const drawdownPercent = (drawdown / peakCapital) * 100;

        if (drawdown > maxDD) {
            maxDD = drawdown;
            maxDDPercent = drawdownPercent;
        }
    }

    return { maxDD, maxDDPercent };
}

function calculateStreaks() {
    const strategy = getStrategy(currentStrategyId);
    if (!strategy) return { maxWinStreak: { pl: 0, count: 0 }, maxLossStreak: { pl: 0, count: 0 } };

    let maxWinStreak = { pl: 0, count: 0 };
    let maxLossStreak = { pl: 0, count: 0 };

    let currentWinPL = 0;
    let currentWinCount = 0;
    let currentLossPL = 0;
    let currentLossCount = 0;

    for (let trade of strategy.tradesData) {
        const plValue = currentPLType === 'GROSS' ? trade.grossPL : trade.netPL;

        if (plValue > 0) {
            currentWinPL += plValue;
            currentWinCount++;

            if (currentLossPL < maxLossStreak.pl) {
                maxLossStreak = { pl: currentLossPL, count: currentLossCount };
            }
            currentLossPL = 0;
            currentLossCount = 0;
        } else if (plValue < 0) {
            currentLossPL += plValue;
            currentLossCount++;

            if (currentWinPL > maxWinStreak.pl) {
                maxWinStreak = { pl: currentWinPL, count: currentWinCount };
            }
            currentWinPL = 0;
            currentWinCount = 0;
        }
    }

    if (currentWinPL > maxWinStreak.pl) {
        maxWinStreak = { pl: currentWinPL, count: currentWinCount };
    }
    if (currentLossPL < maxLossStreak.pl) {
        maxLossStreak = { pl: currentLossPL, count: currentLossCount };
    }

    return { maxWinStreak, maxLossStreak };
}

function formatCurrency(value) {
    if (value === null || value === undefined || isNaN(value)) return '₹0';
    return '₹' + Math.round(value).toLocaleString('en-IN');
}

function renderHeatmapGrid(monthlyData) {
    const strategy = getStrategy(currentStrategyId);
    if (!strategy) return;

    const heatmapGrid = document.getElementById('heatmapGrid');
    heatmapGrid.innerHTML = '';

    const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

    const displayData = {};

    if (strategy.selectedYear === 'ALL') {
        for (let month = 0; month < 12; month++) {
            displayData[month] = 0;
            Object.keys(monthlyData).forEach(year => {
                if (monthlyData[year][month]) {
                    displayData[month] += monthlyData[year][month];
                }
            });
        }
    } else {
        if (monthlyData[strategy.selectedYear]) {
            for (let month = 0; month < 12; month++) {
                displayData[month] = monthlyData[strategy.selectedYear][month] || 0;
            }
        }
    }

    const values = Object.values(displayData);
    const maxAbsValue = Math.max(...values.map(Math.abs));

    for (let month = 0; month < 12; month++) {
        const value = displayData[month] || 0;
        const cell = document.createElement('div');
        cell.className = 'heatmap-cell';

        if (strategy.selectedMonth && strategy.selectedMonth.month === month) {
            if (strategy.selectedYear === 'ALL' || strategy.selectedYear === strategy.selectedMonth.year) {
                cell.classList.add('selected');
            }
        }

        const intensity = maxAbsValue > 0 ? Math.abs(value) / maxAbsValue : 0;
        const minOpacity = 0.3;
        const opacity = minOpacity + (intensity * (1 - minOpacity));

        if (value > 0) {
            cell.style.backgroundColor = `rgba(72, 187, 120, ${opacity})`;
        } else if (value < 0) {
            cell.style.backgroundColor = `rgba(245, 101, 101, ${opacity})`;
        } else {
            cell.style.backgroundColor = 'rgba(203, 213, 224, 0.3)';
        }

        const monthLabel = document.createElement('div');
        monthLabel.className = 'heatmap-month';
        monthLabel.textContent = monthNames[month];

        const valueLabel = document.createElement('div');
        valueLabel.className = 'heatmap-value';
        valueLabel.textContent = formatCurrency(value);

        cell.appendChild(monthLabel);
        cell.appendChild(valueLabel);

        cell.addEventListener('click', function () {
            if (strategy.selectedMonth && strategy.selectedMonth.month === month) {
                strategy.selectedMonth = null;
                document.getElementById('clearMonthFilter').style.display = 'none';
            } else {
                strategy.selectedMonth = {
                    year: strategy.selectedYear === 'ALL' ? null : parseInt(strategy.selectedYear),
                    month: month
                };
                document.getElementById('clearMonthFilter').style.display = 'block';
            }
            saveStrategiesToStorage();
            applyFiltersAndUpdate();
        });

        heatmapGrid.appendChild(cell);
    }
}

function renderHeatmap() {
    const strategy = getStrategy(currentStrategyId);
    if (!strategy) return;

    const monthlyData = calculateMonthlyReturns();
    const years = Object.keys(monthlyData).sort();

    renderYearSelector(years);
    renderHeatmapGrid(monthlyData);
}

function calculateMonthlyReturns() {
    const strategy = getStrategy(currentStrategyId);
    if (!strategy) return {};

    const monthlyData = {};

    for (let trade of strategy.allTradesData) {
        const year = trade.date.getFullYear();
        const month = trade.date.getMonth();
        const plValue = currentPLType === 'GROSS' ? trade.grossPL : trade.netPL;

        if (!monthlyData[year]) {
            monthlyData[year] = {};
        }

        if (!monthlyData[year][month]) {
            monthlyData[year][month] = 0;
        }

        monthlyData[year][month] += plValue;
    }

    return monthlyData;
}

function renderYearSelector(years) {
    const strategy = getStrategy(currentStrategyId);
    if (!strategy) return;

    const yearSelector = document.getElementById('yearSelector');
    yearSelector.innerHTML = '';

    const allBtn = document.createElement('button');
    allBtn.textContent = 'ALL';
    allBtn.className = 'year-btn' + (strategy.selectedYear === 'ALL' ? ' active' : '');
    allBtn.addEventListener('click', function () {
        strategy.selectedYear = 'ALL';
        strategy.selectedMonth = null; // Clear month selection
        saveStrategiesToStorage();
        applyFiltersAndUpdate(); // This will filter data and update all charts
    });
    yearSelector.appendChild(allBtn);

    years.forEach(year => {
        const btn = document.createElement('button');
        btn.textContent = year;
        btn.className = 'year-btn' + (strategy.selectedYear === year ? ' active' : '');
        btn.addEventListener('click', function () {
            strategy.selectedYear = year;
            strategy.selectedMonth = null; // Clear month selection when changing year
            saveStrategiesToStorage();
            applyFiltersAndUpdate(); // This will filter data and update all charts
        });
        yearSelector.appendChild(btn);
    });
}

function createMiniWaterfallChart(trades) {
    const chartDiv = document.getElementById('miniWaterfallChart');
    if (!chartDiv || !trades || trades.length === 0) return;

    const grossProfit = trades.filter(t => t.netPL > 0).reduce((sum, t) => sum + t.netPL, 0);
    const grossLoss = Math.abs(trades.filter(t => t.netPL < 0).reduce((sum, t) => sum + t.netPL, 0));
    const netProfit = grossProfit - grossLoss;

    const data = [
        { x: 'Profit', y: [0, grossProfit], fillColor: '#10b981', label: grossProfit },
        { x: 'Loss', y: [grossProfit - grossLoss, grossProfit], fillColor: '#ef4444', label: grossLoss },
        { x: 'Net', y: [0, netProfit], fillColor: '#3b82f6', label: netProfit }
    ];

    const options = {
        series: [{ name: 'Amount', data: data }],
        chart: { type: 'rangeBar', height: '100%', toolbar: { show: false } },
        plotOptions: {
            bar: { horizontal: false, columnWidth: '60%' }
        },
        dataLabels: { enabled: false },
        xaxis: {
            labels: {
                style: { colors: 'var(--text-primary)', fontSize: '11px' }
            }
        },
        yaxis: {
            labels: {
                formatter: (val) => '₹' + (val / 1000).toFixed(0) + 'K',
                style: { colors: 'var(--text-secondary)', fontSize: '10px' }
            }
        },
        grid: { borderColor: '#374151', strokeDashArray: 4 },
        tooltip: {
            enabled: true,
            custom: function ({ seriesIndex, dataPointIndex, w }) {
                const point = w.config.series[0].data[dataPointIndex];
                return '<div class="mini-chart-tooltip">' +
                    '<div>' + point.x + '</div>' +
                    '<strong>₹' + (point.label / 1000).toFixed(0) + 'K</strong>' +
                    '</div>';
            }
        }

    };

    chartDiv.innerHTML = '';
    new ApexCharts(chartDiv, options).render();
}

// ========================================
// HELPERS FOR MINI CHARTS
// ========================================
function createBinsForTrades(trades) {
    if (trades.length === 0) return [];

    // Predefined exponential bin ranges (in rupees)
    const binRanges = [
        { min: 0, max: 5000, label: '₹0 - ₹5K' },
        { min: 5000, max: 10000, label: '₹5K - ₹10K' },
        { min: 10000, max: 20000, label: '₹10K - ₹20K' },
        { min: 20000, max: 40000, label: '₹20K - ₹40K' },
        { min: 40000, max: 80000, label: '₹40K - ₹80K' },
        { min: 80000, max: Infinity, label: '₹80K+' }
    ];

    const bins = [];
    const totalTrades = trades.length;

    // Count trades in each bin
    for (const range of binRanges) {
        const tradesInBin = trades.filter(t => {
            const value = Math.abs(t.netPL);
            return value >= range.min && value < range.max;
        });

        if (tradesInBin.length > 0) {
            const percentage = Math.round((tradesInBin.length / totalTrades) * 100);
            bins.push({
                label: range.label,
                count: tradesInBin.length,
                percentage: percentage
            });
        }
    }

    return bins;
}


// ========================================
// MINI CHARTS FOR HEADER
// ========================================


function createMiniProfitChart(trades) {
    const chartDiv = document.getElementById('miniProfitChart');
    if (!chartDiv || !trades || trades.length === 0) return;

    const profitTrades = trades.filter(t => t.netPL > 0);
    const bins = createBinsForTrades(profitTrades);
    if (bins.length === 0) return;

    const originalPercentages = bins.map(bin => bin.percentage);
    const maxPercentage = Math.max(...originalPercentages);
    const series = bins.map(bin => maxPercentage > 0 ? (bin.percentage / maxPercentage) * 100 : 0);
    const labels = bins.map(bin => bin.label);

    const options = {
        series: series,
        chart: { type: 'polarArea', height: 170 },
        labels: labels,
        colors: ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#06b6d4'],
        stroke: { colors: ['#1a202c'], width: 1 },
        fill: { opacity: 0.8 },
        legend: { show: false },
        yaxis: { show: false },
        plotOptions: {
            polarArea: {
                rings: {
                    strokeWidth: 0  // ✅ Hide concentric circles
                },
                spokes: {
                    strokeWidth: 1  // Keep radial lines visible
                }
            }
        },

        tooltip: {
            enabled: true,
            y: {
                formatter: function (value, { seriesIndex }) {
                    return originalPercentages[seriesIndex] + '% of trades';
                }
            }
        }

    };

    chartDiv.innerHTML = '';
    new ApexCharts(chartDiv, options).render();
}

function createMiniLossChart(trades) {
    const chartDiv = document.getElementById('miniLossChart');
    if (!chartDiv || !trades || trades.length === 0) return;

    const lossTrades = trades.filter(t => t.netPL < 0);
    const bins = createBinsForTrades(lossTrades);
    if (bins.length === 0) return;

    const originalPercentages = bins.map(bin => bin.percentage);
    const maxPercentage = Math.max(...originalPercentages);
    const series = bins.map(bin => maxPercentage > 0 ? (bin.percentage / maxPercentage) * 100 : 0);
    const labels = bins.map(bin => bin.label);

    const options = {
        series: series,
        chart: { type: 'polarArea', height: 170 },
        labels: labels,
        colors: ['#ef4444', '#ec4899', '#f97316', '#eab308', '#14b8a6'],
        stroke: { colors: ['#1a202c'], width: 1 },
        fill: { opacity: 0.8 },
        legend: { show: false },
        yaxis: { show: false },
        plotOptions: {
            polarArea: {
                rings: {
                    strokeWidth: 0  // ✅ Hide concentric circles
                },
                spokes: {
                    strokeWidth: 1  // Keep radial lines visible
                }
            },

        },

        tooltip: {
            enabled: true,
            y: {
                formatter: function (value, { seriesIndex }) {
                    return originalPercentages[seriesIndex] + '% of trades';
                }
            }
        }

    };

    chartDiv.innerHTML = '';
    new ApexCharts(chartDiv, options).render();
}

function populateInstrumentSelector() {
    const selector = document.getElementById('instrumentSelector');

    // Clear existing options except the first one
    selector.innerHTML = '<option value="">-- Select an instrument --</option>';

    // Add all instruments from library
    instrumentsLibrary.forEach(instrument => {
        const option = document.createElement('option');
        option.value = instrument.id;
        option.textContent = `${instrument.name} (${instrument.data.length} points)`;
        selector.appendChild(option);
    });

    console.log('Populated selector with', instrumentsLibrary.length, 'instruments');
}

function generateForecasting() {
    const strategy = getStrategy(currentStrategyId);
    if (!strategy) return;
    
    const netReturns = strategy.allTradesData.map(t => t.netPL).sort((a, b) => a - b);
    
    const percentile = (arr, p) => {
        const index = (p / 100) * (arr.length - 1);
        const lower = Math.floor(index);
        const upper = Math.ceil(index);
        const weight = index % 1;
        return arr[lower] * (1 - weight) + arr[upper] * weight;
    };
    
    const bestCaseReturn = percentile(netReturns, 75);
    const baseCaseReturn = percentile(netReturns, 50);
    const worstCaseReturn = percentile(netReturns, 25);
    
    const mean = netReturns.reduce((a, b) => a + b, 0) / netReturns.length;
    const variance = netReturns.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / netReturns.length;
    const stdDev = Math.sqrt(variance);
    
    const firstDate = strategy.allTradesData[0].date;
    const lastDate = strategy.allTradesData[strategy.allTradesData.length - 1].date;
    const monthsDiff = (lastDate.getFullYear() - firstDate.getFullYear()) * 12 + 
                      (lastDate.getMonth() - firstDate.getMonth()) + 1;
    const avgTradesPerMonth = strategy.allTradesData.length / monthsDiff;
    
    let currentNetPL = 0;
    for (let trade of strategy.allTradesData) {
        currentNetPL += trade.netPL;
    }
    
    const periods = [
        { name: '1 Month', shortName: '1M', months: 1 },
        { name: '2 Months', shortName: '2M', months: 2 },
        { name: '3 Months', shortName: '3M', months: 3 },
        { name: '6 Months', shortName: '6M', months: 6 },
        { name: '9 Months', shortName: '9M', months: 9 },
        { name: '1 Year', shortName: '1Y', months: 12 },
        { name: '2 Years', shortName: '2Y', months: 24 },
        { name: '4 Years', shortName: '4Y', months: 48 }
    ];
    
    const projections = periods.map(period => {
        const expectedTrades = Math.round(avgTradesPerMonth * period.months);
        
        const bestCase = currentNetPL + (bestCaseReturn * expectedTrades);
        const baseCase = currentNetPL + (baseCaseReturn * expectedTrades);
        const worstCase = currentNetPL + (worstCaseReturn * expectedTrades);
        
        const timeMultiplier = Math.sqrt(expectedTrades);
        const extremeHigh = bestCase + (stdDev * timeMultiplier * 1.5);
        const extremeLow = worstCase - (stdDev * timeMultiplier * 1.5);
        
        return {
            name: period.name,
            shortName: period.shortName,
            expectedTrades: expectedTrades,
            bestCase: bestCase,
            baseCase: baseCase,
            worstCase: worstCase,
            extremeHigh: extremeHigh,
            extremeLow: extremeLow
        };
    });
    
    currentProjections = {
        projections: projections,
        currentPL: currentNetPL
    };
    
    document.getElementById('forecastingSubtitle').textContent = 
        `Based on Net P&L from ${strategy.allTradesData.length} trades`;
    
    if (strategy.allTradesData.length < 50) {
        document.getElementById('forecastWarning').textContent = 
            `⚠️ Note: Sample size is ${strategy.allTradesData.length} trades. Projections become less reliable with limited data.`;
        document.getElementById('forecastWarning').style.display = 'block';
    } else {
        document.getElementById('forecastWarning').style.display = 'none';
    }
    
    renderProjectionTable(projections);
    createProjectionChart(projections, currentNetPL);
}

function createProjectionChart(projections, currentPL) {
    if (projectionChart) {
        projectionChart.destroy();
        projectionChart = null;
    }
    
    const ctx = document.getElementById('projectionChart');
    
    // Filter projections based on current view
    let filteredProjections = projections;
    if (currentForecastView === '1Yr') {
        // Show: 1M, 2M, 3M, 6M, 9M, 1Y
        filteredProjections = projections.filter(p => ['1M', '2M', '3M', '6M', '9M', '1Y'].includes(p.shortName));
    } else if (currentForecastView === '2Yr') {
        // Show: 3M, 6M, 9M, 1Y, 2Y
        filteredProjections = projections.filter(p => ['3M', '6M', '9M', '1Y', '2Y'].includes(p.shortName));
    } else if (currentForecastView === '4Yr') {
        // Show: 1Y, 2Y, 4Y
        filteredProjections = projections.filter(p => ['1Y', '2Y', '4Y'].includes(p.shortName));
    }
    
    const labels = ['Current', ...filteredProjections.map(p => p.shortName)];
    const bestData = [currentPL, ...filteredProjections.map(p => p.bestCase)];
    const baseData = [currentPL, ...filteredProjections.map(p => p.baseCase)];
    const worstData = [currentPL, ...filteredProjections.map(p => p.worstCase)];
    
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim();
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)';
    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim();
    
    const datasets = [];
    
    if (extremeScenarioEnabled) {
        const extremeHighData = [currentPL, ...filteredProjections.map(p => p.extremeHigh)];
        const extremeLowData = [currentPL, ...filteredProjections.map(p => p.extremeLow)];
        
        datasets.push({
            label: 'Extreme High',
            data: extremeHighData,
            borderColor: 'rgba(72, 187, 120, 0.4)',
            backgroundColor: 'rgba(72, 187, 120, 0.15)',
            borderWidth: 1,
            borderDash: [2, 4],
            tension: 0.4,
            pointRadius: 0,
            fill: false
        });
        
        datasets.push({
            label: 'Extreme Low',
            data: extremeLowData,
            borderColor: 'rgba(245, 101, 101, 0.4)',
            backgroundColor: 'rgba(245, 101, 101, 0.15)',
            borderWidth: 1,
            borderDash: [2, 4],
            tension: 0.4,
            pointRadius: 0,
            fill: '-1'
        });
    }
    
    datasets.push({
        label: 'Best Case (75th Percentile)',
        data: bestData,
        borderColor: '#48bb78',
        backgroundColor: 'rgba(72, 187, 120, 0.1)',
        borderWidth: 3,
        borderDash: [8, 4],
        tension: 0.3,
        pointRadius: 6,
        pointBackgroundColor: '#48bb78',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        fill: false
    });
    
    datasets.push({
        label: 'Base Case (Median)',
        data: baseData,
        borderColor: accentColor,
        backgroundColor: accentColor + '20',
        borderWidth: 3,
        borderDash: [8, 4],
        tension: 0.3,
        pointRadius: 6,
        pointBackgroundColor: accentColor,
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        fill: false
    });
    
    datasets.push({
        label: 'Worst Case (25th Percentile)',
        data: worstData,
        borderColor: '#f56565',
        backgroundColor: 'rgba(245, 101, 101, 0.1)',
        borderWidth: 3,
        borderDash: [8, 4],
        tension: 0.3,
        pointRadius: 6,
        pointBackgroundColor: '#f56565',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        fill: false
    });
    
    projectionChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index',
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: textColor,
                        font: { size: 12 },
                        usePointStyle: true,
                        padding: 15
                    }
                },
                tooltip: {
                    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.95)' : 'rgba(0, 0, 0, 0.85)',
                    titleColor: isDark ? '#1a202c' : '#ffffff',
                    bodyColor: isDark ? '#1a202c' : '#ffffff',
                    padding: 12,
                    titleFont: { size: 13, weight: 'bold' },
                    bodyFont: { size: 12 },
                    borderColor: isDark ? '#4a5568' : '#e2e8f0',
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            label += formatCurrency(context.parsed.y);
                            return label;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    grid: { color: gridColor },
                    ticks: {
                        color: textColor,
                        font: { size: 11 },
                        callback: function(value) {
                            return '₹' + (value / 1000).toFixed(0) + 'K';
                        }
                    }
                },
                x: {
                    grid: { display: false },
                    ticks: {
                        color: textColor,
                        font: { size: 12, weight: 'bold' }
                    }
                }
            }
        }
    });
}

function switchForecastView(view) {
    currentForecastView = view;
    document.getElementById('view1Yr').classList.toggle('btn-active', view === '1Yr');
    document.getElementById('view2Yr').classList.toggle('btn-active', view === '2Yr');
    document.getElementById('view4Yr').classList.toggle('btn-active', view === '4Yr');
    
    if (currentProjections) {
        createProjectionChart(currentProjections.projections, currentProjections.currentPL);
    }
}

// Remove instrument link from strategy
function unlinkInstrumentFromStrategy() {
    if (!currentStrategyId) return;

    const strategy = getStrategy(currentStrategyId);
    if (strategy && strategy.selectedInstrument) {
        delete strategy.selectedInstrument;
        saveStrategiesToStorage();
        updateInstrumentButton();
        updateInstrumentButton();
        console.log('Unlinked instrument from strategy');

        // Refresh chart to remove instrument overlay
        applyFiltersAndUpdate();
    }
}

// ====== DASHBOARD UPDATE PIPELINE ======

function 
applyFiltersAndUpdate() {
    const strategy = getStrategy(currentStrategyId);
    if (!strategy) return;

    strategy.tradesData = [...strategy.allTradesData];

    // Filter by year first (if not ALL)
    if (strategy.selectedYear !== 'ALL') {
        strategy.tradesData = strategy.tradesData.filter(trade => {
            const year = trade.date.getFullYear();
            return year === parseInt(strategy.selectedYear);
        });
    }

    // Then filter by month (if selected)
    if (strategy.selectedMonth) {
        strategy.tradesData = strategy.tradesData.filter(trade => {
            const year = trade.date.getFullYear();
            const month = trade.date.getMonth();
            if (strategy.selectedYear === 'ALL') {
                return month === strategy.selectedMonth.month;
            } else {
                return year === strategy.selectedMonth.year && month === strategy.selectedMonth.month;
            }
        });
    }

    console.log("Filtered trades:", strategy.tradesData.length);
    updateDashboard();
}

// Calculate per-trade cumulative P&L and percentage (used by charts and stats)
function calculateTradesCumulativePL() {
    const strategy = getStrategy(currentStrategyId);
    if (!strategy || !Array.isArray(strategy.tradesData)) return;

    let cum = 0;
    for (let t of strategy.tradesData) {
        const plVal = currentPLType === 'GROSS' ? (t.grossPL || 0) : (t.netPL || 0);
        cum += plVal;
        t.cumulativePL = cum;
        t.cumulativePLPercent = strategy.capital && strategy.capital !== 0 ? (cum / strategy.capital) * 100 : 0;
    }
}

function updateDashboard() {
    const strategy = getStrategy(currentStrategyId);
    if (!strategy) return;
    
    hideError();
    
    if (strategy.tradesData.length === 0) {
        showError('No trades match the current filter');
        return;
    }
    
    // Calculate per-trade cumulative P&L and percentages
    calculateTradesCumulativePL();
    
    // Show all sections
    document.getElementById('overviewHeaderCompact').style.display = 'block';
    document.getElementById('mainContent').style.display = 'grid';
    document.getElementById('miniChartsSection').style.display = 'grid';  // NEW
    document.getElementById('lowerSection').style.display = 'grid';
    document.getElementById('forecastingToggleContainer').style.display = 'block';
    
    // Update strategy name
    document.getElementById('selectedStrategy').textContent = strategy.name;
    
    updateTimePeriodInfo();
    createChart();
    calculateStatistics();
    renderHeatmap();
    
    // Create mini charts (now in visible section)
    createMiniWaterfallChart(strategy.tradesData);
    createMiniProfitChart(strategy.tradesData);
    createMiniLossChart(strategy.tradesData);
    
    if (forecastingEnabled) {
        generateForecasting();
    }
}


function updateTimePeriodInfo() {
    const strategy = getStrategy(currentStrategyId);
    if (!strategy || strategy.tradesData.length === 0) return;
    
    const firstDate = strategy.tradesData[0].date;
    const lastDate = strategy.tradesData[strategy.tradesData.length - 1].date;
    
    const formatDate = (date) => {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return date.getDate() + ' ' + months[date.getMonth()] + ' ' + date.getFullYear();
    };
    
    document.getElementById('timePeriod').textContent = formatDate(firstDate) + ' - ' + formatDate(lastDate);
    document.getElementById('totalTradesInfo').textContent = strategy.tradesData.length;
    
    const monthsDiff = (lastDate.getFullYear() - firstDate.getFullYear()) * 12 + 
                      (lastDate.getMonth() - firstDate.getMonth()) + 1;
    const avgTradesPerMonth = (strategy.tradesData.length / monthsDiff).toFixed(1);
    document.getElementById('avgTradesMonth').textContent = avgTradesPerMonth;
}

// ========== CHART CONTROLS ==========

function switchView(view) {
    currentView = view;
    document.getElementById('btnINR').classList.toggle('btn-active', view === 'INR');
    document.getElementById('btnPercent').classList.toggle('btn-active', view === 'PERCENT');
    createChart();
}

function switchPLType(plType) {
    currentPLType = plType;
    document.getElementById('btnGross').classList.toggle('btn-active', plType === 'GROSS');
    document.getElementById('btnNet').classList.toggle('btn-active', plType === 'NET');
    applyFiltersAndUpdate();
}

function clearMonthFilter() {
    const strategy = getStrategy(currentStrategyId);
    if (!strategy) return;
    
    strategy.selectedMonth = null;
    document.getElementById('clearMonthFilter').style.display = 'none';
    applyFiltersAndUpdate();
}

// ========== MAIN CHART ==========

function createChart() {
    const strategy = getStrategy(currentStrategyId);
    if (!strategy) return;
    
    if (myChart) {
        myChart.destroy();
        myChart = null;
    }
    
    const ctx = document.getElementById('chart');
    
    const labels = [];
    const dataPoints = [];
    
    for (let trade of strategy.tradesData) {
        const dateStr = trade.date.getDate() + ' ' + 
                        trade.date.toLocaleString('en', { month: 'short' }) + ' ' + 
                        trade.date.getFullYear();
        labels.push(dateStr);
        
        const value = currentView === 'INR' ? trade.cumulativePL : trade.cumulativePLPercent;
        dataPoints.push(value);
    }
    
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim();
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim();
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)';
    
    // Prepare datasets array
    const datasets = [{
        label: strategy.name + ' - ' + (currentView === 'INR' ? 'Net P&L (₹)' : 'Net Returns (%)'),
        data: dataPoints,
        borderColor: isDark ? '#667eea' : '#5a67d8',
        backgroundColor: isDark ? 'rgba(102, 126, 234, 0.1)' : 'rgba(90, 103, 216, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.1,
        pointRadius: 0,
        pointHoverRadius: 4,
        yAxisID: 'y'
    }];

   
    if (strategy && strategy.selectedInstrument) {
        const instrument = instrumentsLibrary.find(i => i.id === strategy.selectedInstrument);
        if (instrument && instrument.data) {
            console.log('Adding instrument overlay:', instrument.name);

            // Normalize instrument data to match strategy dates
            // We already have actual Date objects for each trade
            const strategyDates = strategy.tradesData.map(trade => trade.date);


            const normalizedInstrument = normalizeInstrumentData(instrument.data, strategyDates);

            // Prepare instrument data based on current view
            let instrumentDisplayData;
            if (currentView === 'PERCENT') {
                // Show percentage change from start
                instrumentDisplayData = normalizedInstrument.map(point => point.percentChange);
            } else {
                // Show raw values
                instrumentDisplayData = normalizedInstrument.map(point => point.value);
            }

            // Add instrument dataset
            datasets.push({
                label: instrument.name,
                data: instrumentDisplayData,
                borderColor: isDark ? '#f6ad55' : '#ed8936',
                backgroundColor: 'transparent',
                borderWidth: 2,
                fill: false,
                tension: 0.1,
                pointRadius: 0,
                pointHoverRadius: 4,
                yAxisID: currentView === 'PERCENT' ? 'y' : 'y1', // Same axis for %, different for INR
                borderDash: [5, 5] // Dashed line to differentiate
            });
        }
    }

    // Create chart with updated datasets
    myChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: isDark ? '#e2e8f0' : '#2d3748',
                        usePointStyle: true,
                        padding: 15,
                        font: {
                            size: 12,
                            weight: '500'
                        }
                    }
                },
                tooltip: {
                    backgroundColor: isDark ? 'rgba(26, 32, 44, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                    titleColor: isDark ? '#e2e8f0' : '#2d3748',
                    bodyColor: isDark ? '#cbd5e0' : '#4a5568',
                    borderColor: isDark ? '#4a5568' : '#e2e8f0',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: true,
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                if (currentView === 'PERCENT') {
                                    label += context.parsed.y.toFixed(2) + '%';
                                } else {
                                    label += '₹' + context.parsed.y.toLocaleString('en-IN');
                                }
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        color: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
                        drawBorder: false
                    },
                    ticks: {
                        color: isDark ? '#a0aec0' : '#718096',
                        maxTicksLimit: 12,
                        font: {
                            size: 11
                        }
                    }
                },
                y: {
                    position: 'left',
                    grid: {
                        color: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
                        drawBorder: false
                    },
                    ticks: {
                        color: isDark ? '#a0aec0' : '#718096',
                        font: {
                            size: 11
                        },
                        callback: function (value) {
                            if (currentView === 'PERCENT') {
                                return value.toFixed(1) + '%';
                            } else {
                                return '₹' + (value / 1000).toFixed(0) + 'K';
                            }
                        }
                    },
                    title: {
                        display: true,
                        text: currentView === 'PERCENT' ? 'Returns (%)' : 'P&L (₹)',
                        color: isDark ? '#e2e8f0' : '#2d3748',
                        font: {
                            size: 12,
                            weight: '600'
                        }
                    }
                },
                y1: {
                    position: 'right',
                    display: currentView === 'INR' && datasets.length > 1, // Only show when instrument is present and view is INR
                    grid: {
                        drawOnChartArea: false // Don't draw grid lines for second axis
                    },
                    ticks: {
                        color: isDark ? '#f6ad55' : '#ed8936',
                        font: {
                            size: 11
                        },
                        callback: function (value) {
                            return '₹' + value.toLocaleString('en-IN');
                        }
                    },
                    title: {
                        display: true,
                        text: 'Instrument Price (₹)',
                        color: isDark ? '#f6ad55' : '#ed8936',
                        font: {
                            size: 12,
                            weight: '600'
                        }
                    }
                }
            }
        }
    });
}   // <<< close createChart here

// ========== STATISTICS ==========



 
// ========== FORECASTING ==========





function renderProjectionTable(projections) {
    const tbody = document.getElementById('projectionTableBody');
    tbody.innerHTML = '';
    
    projections.forEach(proj => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="period-cell">${proj.name}</td>
            <td class="trades-cell">${proj.expectedTrades}</td>
            <td class="best-value">${formatCurrency(proj.bestCase)}</td>
            <td class="base-value">${formatCurrency(proj.baseCase)}</td>
            <td class="worst-value">${formatCurrency(proj.worstCase)}</td>
        `;
        tbody.appendChild(row);
    });
}



// ========== HEATMAP ==========







// ========== HELPER FUNCTIONS ==========

function refreshAllCharts() {
    if (currentStrategyId) {
        createChart();
        renderHeatmap();
        if (forecastingEnabled) {
            createProjectionChart(currentProjections.projections, currentProjections.currentPL);
        }
    }
    
    if (document.getElementById('compareSection').style.display === 'block') {
        updateComparison();
    }

        // Refresh pie charts
    const strategy = getStrategy(currentStrategyId);
    if (strategy && strategy.tradesData) {
        // Use radial chart renderer (replaces legacy pie function names)
        createRadialCharts(strategy.tradesData);
    }

}


// ========================================
// RADIAL CHARTS - TRADE DISTRIBUTION
// ========================================
// ========== RADIAL CHARTS - TRADE DISTRIBUTION ==========

    function createRadialCharts(trades) {
        console.log('🔵 createRadialCharts called with', trades ? trades.length : 0, 'trades');

        const section = document.getElementById('radialChartsSection');
        const profitDiv = document.getElementById('profitRadialChart');
        const lossDiv = document.getElementById('lossRadialChart');

        if (!section || !profitDiv || !lossDiv) {
            console.log('❌ Radial chart elements not found in HTML');
            return;
        }

        if (!trades || trades.length === 0) {
            console.log('❌ No trades data');
            section.style.display = 'none';
            return;
        }

        const profitTrades = trades.filter(t => t.netPL > 0);
        const lossTrades = trades.filter(t => t.netPL < 0);

        createProfitRadialChart(profitTrades);
        createLossRadialChart(lossTrades);

        section.style.display = 'block';
    }

    function createProfitRadialChart(profitTrades) {
        if (!profitTrades || profitTrades.length === 0) {
            document.getElementById('profitRadialChart').innerHTML =
                '<p style="text-align:center;padding:50px;color:var(--text-secondary);">No profit trades</p>';
            return;
        }

        const bins = createBinsForTrades(profitTrades);

        const originalPercentages = bins.map(bin => bin.percentage);
        const maxPercentage = Math.max(...originalPercentages);

        const series = bins.map(bin =>
            maxPercentage > 0 ? (bin.percentage / maxPercentage) * 100 : 0
        );
        const labels = bins.map(bin => bin.label);

        const options = {
            series: series,
            chart: {
                type: 'polarArea',
                height: 350
            },
            labels: labels,
            colors: ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#06b6d4'],
            stroke: {
                colors: ['#1a202c'],
                width: 2
            },
            fill: {
                opacity: 0.8
            },
            plotOptions: {
                polarArea: {
                    rings: {
                        strokeWidth: 1,
                        strokeColor: '#374151'
                    },
                    spokes: {
                        strokeWidth: 1,
                        connectorColors: '#374151'
                    }
                }
            },
            legend: {
                show: true,
                position: 'right',
                fontSize: '18px',
                labels: {
                    colors: 'var(--text-primary)'
                },
                markers: {
                    width: 14,
                    height: 20
                },
                itemMargin: {
                    horizontal: 10,
                    vertical: 8
                }
            },
            yaxis: {
                show: false
            },
            tooltip: {
                y: {
                    formatter: function (value, { seriesIndex }) {
                        return originalPercentages[seriesIndex] + '% of trades';
                    }
                }
            }
        };

        const container = document.getElementById('profitRadialChart');
        container.innerHTML = '';
        const chart = new ApexCharts(container, options);
        chart.render();
    }

    function createLossRadialChart(lossTrades) {
        if (!lossTrades || lossTrades.length === 0) {
            document.getElementById('lossRadialChart').innerHTML =
                '<p style="text-align:center;padding:50px;color:var(--text-secondary);">No loss trades</p>';
            return;
        }

        const absoluteLosses = lossTrades.map(t => ({ ...t, netPL: Math.abs(t.netPL) }));
        const bins = createBinsForTrades(absoluteLosses);

        const originalPercentages = bins.map(bin => bin.percentage);
        const maxPercentage = Math.max(...originalPercentages);

        const series = bins.map(bin =>
            maxPercentage > 0 ? (bin.percentage / maxPercentage) * 100 : 0
        );
        const labels = bins.map(bin => bin.label);

        const options = {
            series: series,
            chart: {
                type: 'polarArea',
                height: 350
            },
            labels: labels,
            colors: ['#ef4444', '#ec4899', '#f97316', '#eab308', '#14b8a6'],
            stroke: {
                colors: ['#1a202c'],
                width: 2
            },
            fill: {
                opacity: 0.8
            },
            plotOptions: {
                polarArea: {
                    rings: {
                        strokeWidth: 1,
                        strokeColor: '#374151'
                    },
                    spokes: {
                        strokeWidth: 1,
                        connectorColors: '#374151'
                    }
                }
            },
            legend: {
                show: true,
                position: 'right',
                fontSize: '18px',
                labels: {
                    colors: 'var(--text-primary)'
                },
                markers: {
                    width: 14,
                    height: 20
                },
                itemMargin: {
                    horizontal: 10,
                    vertical: 8
                }
            },
            yaxis: {
                show: false
            },
            tooltip: {
                y: {
                    formatter: function (value, { seriesIndex }) {
                        return originalPercentages[seriesIndex] + '% of trades';
                    }
                }
            }
        };

        const container = document.getElementById('lossRadialChart');
        container.innerHTML = '';
        const chart = new ApexCharts(container, options);
        chart.render();
    }




// ========================================
// WATERFALL CHART - PROFIT STRUCTURE
// ========================================

function createWaterfallChart(trades) {
    const section = document.getElementById('waterfallSection');
    const chartDiv = document.getElementById('waterfallChart');
    
    if (!section || !chartDiv) {
        console.log('Waterfall chart elements not found');
        return;
    }
    
    if (!trades || trades.length === 0) return;
    
    // Calculate values
    const grossProfit = trades.filter(t => t.netPL > 0).reduce((sum, t) => sum + t.netPL, 0);
    const grossLoss = Math.abs(trades.filter(t => t.netPL < 0).reduce((sum, t) => sum + t.netPL, 0));
    const netProfit = grossProfit - grossLoss;
    
    // Waterfall logic: [start, end] for each bar
    const data = [
        {
            x: 'Gross Profit',
            y: [0, grossProfit],
            fillColor: '#10b981',
            label: grossProfit
        },
        {
            x: 'Gross Loss',
            y: [grossProfit - grossLoss, grossProfit],
            fillColor: '#ef4444',
            label: grossLoss
        },
        {
            x: 'Net Profit',
            y: [0, netProfit],
            fillColor: '#3b82f6',
            label: netProfit
        }
    ];
    
    const options = {
        series: [{
            name: 'Amount',
            data: data
        }],
        chart: {
            type: 'rangeBar',
            height: 400,
            toolbar: { show: false }
        },
        plotOptions: {
            bar: {
                horizontal: false,
                columnWidth: '50%',
                dataLabels: {
                    position: 'top'
                }
            }
        },
        dataLabels: {
            enabled: true,
            formatter: function(val, opts) {
                return '₹' + (opts.w.config.series[0].data[opts.dataPointIndex].label / 1000).toFixed(0) + 'K';
            },
            offsetY: -25,
            style: {
                fontSize: '15px',
                fontWeight: 'bold',
                colors: ['#1a202c']
            },
            background: {
                enabled: true,
                foreColor: '#ffffff',
                borderRadius: 4,
                padding: 6,
                opacity: 0.95,
                borderWidth: 1,
                borderColor: '#e2e8f0'
            }
        },
        xaxis: {
            labels: {
                style: {
                    colors: 'var(--text-primary)',
                    fontSize: '14px',
                    fontWeight: 500
                }
            },
            axisBorder: {
                color: '#374151'
            }
        },
        yaxis: {
            labels: {
                formatter: function(val) {
                    return '₹' + (val / 1000).toFixed(0) + 'K';
                },
                style: {
                    colors: 'var(--text-secondary)',
                    fontSize: '13px'
                }
            }
        },
        grid: {
            borderColor: '#374151',
            strokeDashArray: 4,
            xaxis: {
                lines: {
                    show: true
                }
            }
        },
        tooltip: {
        custom: function({ seriesIndex, dataPointIndex, w }) {
        const point = w.config.series[0].data[dataPointIndex];
        return '<div class="waterfall-tooltip">' +
            '<div style="color: #94a3b8; font-size: 12px;">' + point.x + '</div>' +
            '<div style="color: #f1f5f9; font-size: 15px; font-weight: 600; margin-top: 4px;">₹' + 
            point.label.toLocaleString('en-IN', { maximumFractionDigits: 2 }) + '</div>' +
            '</div>';
            }
        },

        annotations: {
            xaxis: [
                {
                    x: 1.5,
                    x2: 1.5,
                    strokeDashArray: 4,
                    borderColor: '#78909c',
                    label: {
                        text: ''
                    }
                }
            ]
        }
    };
    
    chartDiv.innerHTML = '';
    const chart = new ApexCharts(chartDiv, options);
    chart.render();
    section.style.display = 'block';
}



// ========================================
// ==========================================
// INSTRUMENT DATA MANAGEMENT
// ==========================================




function closeInstrumentModal() {
    document.getElementById('instrumentModal').style.display = 'none';
    document.getElementById('instrumentError').style.display = 'none';
    document.getElementById('instrumentFileName').textContent = '';
}

// Handle instrument selector change
function handleInstrumentSelectorChange() {
    const selector = document.getElementById('instrumentSelector');
    const uploadSection = document.getElementById('instrumentName').parentElement.parentElement;

    if (selector.value) {
        // Instrument selected from dropdown - hide upload section
        uploadSection.style.opacity = '0.5';
        uploadSection.style.pointerEvents = 'none';
        document.getElementById('instrumentName').value = '';
        document.getElementById('instrumentFileName').textContent = '';
        pendingInstrumentData = null;
    } else {
        // No selection - enable upload section
        uploadSection.style.opacity = '1';
        uploadSection.style.pointerEvents = 'auto';
    }
}


// Handle instrument file upload
function handleInstrumentFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    document.getElementById('instrumentFileName').textContent = file.name;

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array', cellDates: true });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(firstSheet, { raw: false, dateNF: 'dd-mm-yyyy', header: 1 });

            console.log('Loaded', jsonData.length, 'rows from instrument file');

            if (jsonData.length < 2) {
                showInstrumentError('File must have at least 2 rows (1 header + 1 data)');
                return;
            }

            // Store temporarily
            pendingInstrumentData = jsonData;

        } catch (error) {
            showInstrumentError('Error reading file: ' + error.message);
            console.error('File read error:', error);
        }
    };

    reader.readAsArrayBuffer(file);
    event.target.value = ''; // Reset file input
}

// Process and validate instrument data
function processInstrumentData(jsonData) {
    const instrumentData = [];
    let skippedRows = 0;

    // Skip header row (row 0)
    for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i];

        // Extract date (column 0)
        let dateStr = row[0];
        let date = parseDate(dateStr); // Reuse existing parseDate function

        if (!date) {
            console.warn(`Skipping row ${i + 1} - Invalid date:`, dateStr);
            skippedRows++;
            continue;
        }

        // Extract close price (column 1)
        let close = parseFloat(row[1]);
        if (isNaN(close)) {
            console.warn(`Skipping row ${i + 1} - Invalid close price`);
            skippedRows++;
            continue;
        }

        instrumentData.push({
            date: date,
            close: close
        });
    }

    // Sort by date
    instrumentData.sort((a, b) => a.date - b.date);

    console.log('Processed', instrumentData.length, 'instrument data points');
    if (skippedRows > 0) {
        console.log('Skipped', skippedRows, 'invalid rows');
    }

    return instrumentData;
}


    // Confirm and save instrument
    function confirmInstrumentUpload() {
        const selector = document.getElementById('instrumentSelector');
        const nameInput = document.getElementById('instrumentName');
        const errorDiv = document.getElementById('instrumentError');

        // Hide previous errors
        errorDiv.style.display = 'none';

        // OPTION 1: selecting existing instrument
        if (selector.value) {
            const instrument = instrumentsLibrary.find(i => i.id === selector.value);
            if (instrument) {
                console.log('Selected existing instrument:', instrument.name);
                linkInstrumentToStrategy(instrument.id);
                closeInstrumentModal();
                return;
            }
        }

        // OPTION 2: uploading new instrument
        if (!pendingInstrumentData) {
            showInstrumentError('Please select a file to upload or choose an existing instrument');
            return;
        }

        const instrumentName = nameInput.value.trim();
        if (!instrumentName) {
            showInstrumentError('Please enter an instrument name');
            return;
        }

        // Check for duplicate names
        const duplicate = instrumentsLibrary.find(
            i => i.name.toLowerCase() === instrumentName.toLowerCase()
        );
        if (duplicate) {
            showInstrumentError('An instrument with this name already exists');
            return;
        }

        // Process the data
        const processedData = processInstrumentData(pendingInstrumentData);
        if (processedData.length === 0) {
            showInstrumentError('No valid data found in the file');
            return;
        }

        // Create new instrument
        const newInstrument = {
            id: 'instrument_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
            name: instrumentName,
            data: processedData,
            createdAt: new Date().toISOString()
        };

        // Add to library
        instrumentsLibrary.push(newInstrument);
        saveInstrumentsToStorage();

        console.log('✅ Instrument created:', newInstrument.name, 'with', processedData.length, 'data points');

        // Link to current strategy
        linkInstrumentToStrategy(newInstrument.id);

        // Clear and close
        pendingInstrumentData = null;
        closeInstrumentModal();
    }


// Link instrument to strategy
function linkInstrumentToStrategy(instrumentId) {
    if (!currentStrategyId) return;

    const strategy = getStrategy(currentStrategyId);
    if (strategy) {
        strategy.selectedInstrument = instrumentId;
        saveStrategiesToStorage();
        console.log('Linked instrument to strategy:', strategy.name);

        // Update button appearance
        updateInstrumentButton();

        // Refresh chart to show instrument overlay
        applyFiltersAndUpdate();
        console.log('Chart refreshed with instrument overlay');

    }
}




// Show error in modal
function showInstrumentError(message) {
    const errorDiv = document.getElementById('instrumentError');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}


    // Setup instrument modal event listeners
    document.addEventListener('DOMContentLoaded', function () {
        const cancelBtn = document.getElementById('cancelInstrument');
        const confirmBtn = document.getElementById('confirmInstrument');

        if (cancelBtn) {
            cancelBtn.addEventListener('click', closeInstrumentModal);
        }

        if (confirmBtn) {
            confirmBtn.addEventListener('click', function () {
                console.log('Confirm instrument clicked');
                confirmInstrumentUpload();
            });
        }

        // File input change handler
        const fileInput = document.getElementById('instrumentFileInput');
        if (fileInput) {
            fileInput.addEventListener('change', handleInstrumentFileUpload);
        }

        // Selector change handler
        const selector = document.getElementById('instrumentSelector');
        if (selector) {
            selector.addEventListener('change', handleInstrumentSelectorChange);
        }
    });

    // ==========================================
    // INSTRUMENT DATA - CHART INTEGRATION
    // ==========================================

    // Normalize instrument data to match strategy date range
    function normalizeInstrumentData(instrumentData, strategyDates) {
        if (!instrumentData || instrumentData.length === 0) return [];
        if (!strategyDates || strategyDates.length === 0) return [];

        const normalized = [];
        const firstStrategyDate = strategyDates[0];
        const lastStrategyDate = strategyDates[strategyDates.length - 1];

        const relevantData = instrumentData.filter(point =>
            point.date >= firstStrategyDate && point.date <= lastStrategyDate
        );

        if (relevantData.length === 0) return [];

        const baseValue = relevantData[0].close;

        strategyDates.forEach(strategyDate => {
            let closestPoint = null;
            let minDiff = Infinity;

            for (let i = 0; i < relevantData.length; i++) {
                const diff = Math.abs(relevantData[i].date - strategyDate);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestPoint = relevantData[i];
                }
                if (relevantData[i].date > strategyDate) break;
            }

            if (closestPoint) {
                const percentChange = ((closestPoint.close - baseValue) / baseValue) * 100;
                normalized.push({
                    date: strategyDate,
                    value: closestPoint.close,
                    percentChange: percentChange
                });
            } else {
                normalized.push({
                    date: strategyDate,
                    value: null,
                    percentChange: null
                });
            }
        });

        return normalized;
    }


    // Calculate percentage returns from cumulative PL
    function calculatePercentageReturns(cumulativeData, capital) {
        return cumulativeData.map(value => {
            if (value === null) return null;
            return (value / capital) * 100;
        });
    }

// Temporary: Get redirect URL
console.log("Firefox Redirect URL:", browser.identity.getRedirectURL());
// ========================================
