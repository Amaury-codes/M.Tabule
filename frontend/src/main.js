// --- DEBUT DU FICHIER main.js ---

import './style.css'; 
import * as runtime from '/wailsjs/runtime/runtime';
import { SelectDirectory, ProcessFiles, ConfirmDialog, SelectAndReadTestFile, ListProfiles, SaveProfile, LoadProfile, DeleteProfile } from '/wailsjs/go/main/App';

const colors = ["#4e73df", "#1cc88a", "#36b9cc", "#f6c23e", "#e74a3b", "#858796", "#5a5c69"];
let previewData = [];
let profilActif = null;
let testFileContentCache = "";

function showAlert(type, message) {
    const alertId = type === 'success' ? 'success-alert' : 'warning-alert';
    const messageId = type === 'success' ? 'success-alert-message' : 'warning-alert-message';
    document.getElementById(messageId).textContent = message;
    const alertElement = document.getElementById(alertId);
    alertElement.classList.remove('d-none');
    setTimeout(() => alertElement.classList.add('d-none'), 5000);
}
function applyTrim(text, prefix, suffix) {
    let result = text || '';
    if (prefix > 0 && result.length > prefix) result = result.substring(prefix);
    if (suffix > 0 && result.length > suffix) result = result.substring(0, result.length - suffix);
    return result.trim();
}
async function handleTestFileSelection() {
    try {
        const fileContent = await SelectAndReadTestFile();
        if (fileContent === null || fileContent === undefined) return;
        testFileContentCache = fileContent;
        document.getElementById('testFilePath').placeholder = "Fichier de test chargé";
        parseAndDisplayTestPreview();
    } catch (err) { alert(`Erreur de sélection : ${err}`); }
}

// MODIFIÉ: Logique de création des tags d'aperçu corrigée pour restaurer le Drag & Drop
function parseAndDisplayTestPreview() {
    if (!testFileContentCache) {
        document.getElementById('preview').innerHTML = '<span class="text-muted">(Chargez un fichier pour voir l\'aperçu)</span>';
        previewData = [];
        updateCsvPreview();
        return;
    }
    const firstLine = testFileContentCache.split('\n')[0].trim();
    const separator = document.getElementById('separator').value;
    previewData = firstLine.split(separator);

    const preview = document.getElementById('preview');
    preview.innerHTML = '';
    if (firstLine === '') { preview.textContent = '(Fichier vide)'; updateCsvPreview(); return; }

    // Utilise la création simple de <span>, qui est correcte pour les sources "draggable".
    previewData.forEach((val, i) => {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.style.backgroundColor = colors[i % colors.length];
        tag.textContent = val.trim();
        tag.setAttribute('draggable', 'true');
        tag.dataset.originalIndex = i;
        tag.ondragstart = (event) => {
            event.dataTransfer.setData("application/json", JSON.stringify({
                text: val.trim(), index: i, color: colors[i % colors.length]
            }));
        };
        preview.appendChild(tag);
    });
    updateCsvPreview();
}

function getCurrentConfiguration(profileName) {
    const extractZone = document.getElementById('extractZone');
    const columns = [...extractZone.children].map(tag => {
        const isFusion = !!tag.dataset.fusionRule;
        const columnConfig = {
            isFusion: isFusion,
            columnName: tag.querySelector('.column-name-input')?.value || 'sans_nom',
            originalText: tag.querySelector('.original-text').textContent
        };
        if (isFusion) { columnConfig.fusionRule = JSON.parse(tag.dataset.fusionRule); }
        else {
            columnConfig.originalIndex = parseInt(tag.dataset.originalIndex);
            columnConfig.prefixTrim = parseInt(tag.dataset.prefixTrim || "0");
            columnConfig.suffixTrim = parseInt(tag.dataset.suffixTrim || "0");
        }
        return columnConfig;
    });
    return { 
        name: profileName, 
        separator: document.getElementById('separator').value, 
        columns: columns,
        recursive: document.getElementById('recursiveSwitch').checked,
        outputMode: document.querySelector('input[name="outputMode"]:checked').value,
        saveLocation: document.querySelector('input[name="saveLocation"]:checked').value,
        autoDetectEnabled: document.getElementById('autoDetectEnabledSwitch').checked,
        autoDetectIndex: parseInt(document.getElementById('autoDetectIndex').value) - 1,
        autoDetectValue: document.getElementById('autoDetectValue').value.trim()
    };
}
function applyProfileToUI(profile) {
    document.getElementById('profileName').value = profile.name;
    document.getElementById('separator').value = profile.separator;
    const recursiveSwitch = document.getElementById('recursiveSwitch');
    recursiveSwitch.checked = profile.recursive || false;
    recursiveSwitch.dispatchEvent(new Event('change'));
    if (profile.outputMode) document.querySelector(`input[name="outputMode"][value="${profile.outputMode}"]`).checked = true;
    else document.getElementById('outputSingleFile').checked = true;
    if (profile.saveLocation) document.querySelector(`input[name="saveLocation"][value="${profile.saveLocation}"]`).checked = true;
    else document.getElementById('saveLocationPrompt').checked = true;
    
    const autoDetectSwitch = document.getElementById('autoDetectEnabledSwitch');
    autoDetectSwitch.checked = profile.autoDetectEnabled || false;
    autoDetectSwitch.dispatchEvent(new Event('change'));
    document.getElementById('autoDetectIndex').value = (profile.autoDetectIndex !== undefined ? profile.autoDetectIndex : 0) + 1;
    document.getElementById('autoDetectValue').value = profile.autoDetectValue || "";

    const extractZone = document.getElementById('extractZone');
    extractZone.innerHTML = '';
    if (profile.columns) {
        profile.columns.forEach(colConfig => {
            const color = colConfig.originalIndex >= 0 ? colors[colConfig.originalIndex % colors.length] : '#858796';
            const tag = createConfigurableTag(colConfig.originalText, colConfig.originalIndex, true, color);
            tag.querySelector('.column-name-input').value = colConfig.columnName;
            if (colConfig.isFusion) {
                tag.dataset.fusionRule = JSON.stringify(colConfig.fusionRule);
            } else {
                tag.dataset.prefixTrim = colConfig.prefixTrim || 0;
                tag.dataset.suffixTrim = colConfig.suffixTrim || 0;
                const settings = tag.querySelector('.tag-settings');
                if (settings) {
                  settings.querySelector('.trim-input-prefix').value = colConfig.prefixTrim || 0;
                  settings.querySelector('.trim-input-suffix').value = colConfig.suffixTrim || 0;
                }
            }
            extractZone.appendChild(tag);
        });
    }
}
async function handleSaveProfile() {
    const profileNameInput = document.getElementById('profileName');
    const profileName = profileNameInput.value.trim();
    if (!profileName) { alert("Veuillez donner un nom à votre profil."); return; }
    const newProfile = getCurrentConfiguration(profileName);
    if (newProfile.columns.length === 0) { alert("Impossible de sauvegarder un profil vide."); return; }
    try {
        const existingProfiles = await ListProfiles();
        if (existingProfiles.includes(profileName)) {
            const response = await ConfirmDialog("Remplacer le profil ?", `Un profil nommé "${profileName}" existe déjà. Voulez-vous le remplacer ?`);
            if (response !== "Supprimer") { return; }
        }
        await SaveProfile(JSON.stringify(newProfile));
        profilActif = profileName;
        await updateProfileListUI();
        document.getElementById('profileSelector').value = profileName;
        showAlert('success', `Le profil "${profileName}" a été sauvegardé !`);
    } catch (err) { console.error("Erreur sauvegarde profil:", err); alert(`Erreur de sauvegarde : ${err}`); }
}
async function handleLoadProfile() {
    const selector = document.getElementById('profileSelector');
    const profileName = selector.value;
    if (!profileName) { profilActif = null; return; }
    try {
        const profileJSON = await LoadProfile(profileName);
        const profileToLoad = JSON.parse(profileJSON);
        applyProfileToUI(profileToLoad);
        profilActif = profileToLoad.name;
        updateCsvPreview();
        showAlert('success', `Profil "${profileName}" chargé.`);
    } catch (err) {
        profilActif = null; console.error("Erreur chargement profil:", err);
        alert(`Erreur de chargement : ${err}. Ce profil n'existe peut-être plus.`);
        await updateProfileListUI();
    }
}
async function handleDeleteProfile() {
    const selector = document.getElementById('profileSelector');
    const profileNameToDelete = selector.value;
    if (!profileNameToDelete) { alert("Veuillez sélectionner un profil à supprimer."); return; }
    try {
        const userResponse = await ConfirmDialog("Confirmation", `Supprimer le profil "${profileNameToDelete}" ?`);
        if (userResponse !== "Supprimer") { return; }
        const response = await DeleteProfile(profileNameToDelete);
        if (response.success) {
            showAlert('success', response.message);
            document.getElementById('profileName').value = ''; document.getElementById('extractZone').innerHTML = '';
            if (profilActif === profileNameToDelete) profilActif = null;
            await updateProfileListUI(); updateCsvPreview();
        } else { alert(`Échec suppression : ${response.message}`); }
    } catch (err) { console.error("Erreur suppression:", err); alert("Erreur inattendue."); }
}
async function updateProfileListUI() {
    const selector = document.getElementById('profileSelector');
    const currentValue = selector.value;
    selector.innerHTML = '<option value="">-- Aucun profil sélectionné --</option>';
    try {
        const profileNames = await ListProfiles() || [];
        profileNames.sort((a, b) => a.localeCompare(b)).forEach(name => {
            const option = document.createElement('option');
            option.value = name; option.textContent = name;
            selector.appendChild(option);
        });
        const selectedProfileInList = profileNames.find(p => p === currentValue);
        selector.value = selectedProfileInList ? currentValue : "";
    } catch (err) { console.error("Erreur liste profils:", err); alert("Erreur: Impossible de lister les profils.") }
}
function createFusion() {
    const fusionZone = document.getElementById('fusionZone');
    const children = [...fusionZone.children];
    if (children.length < 2) { alert("Glissez au moins deux données."); return; }
    const separator = document.getElementById('fusionSeparator').value || ' ';
    const fusionRule = { separator: separator, parts: [] };
    const fusionTextParts = [];
    children.forEach(el => {
        const partRule = {
            originalIndex: parseInt(el.dataset.originalIndex),
            prefix: parseInt(el.dataset.prefixTrim || "0"),
            suffix: parseInt(el.dataset.suffixTrim || "0")
        };
        fusionRule.parts.push(partRule);
        const originalText = previewData[partRule.originalIndex] || '';
        fusionTextParts.push(applyTrim(originalText, partRule.prefix, partRule.suffix));
    });
    const fusionText = fusionTextParts.join(separator);
    const fusionTag = createConfigurableTag(fusionText, -1, true, "#858796");
    fusionTag.dataset.fusionRule = JSON.stringify(fusionRule);
    fusionTag.querySelector('.column-name-input').value = 'colonne_fusionnee';
    document.getElementById('extractZone').appendChild(fusionTag);
    fusionZone.innerHTML = '';
    updateCsvPreview();
}
async function processFiles() {
    const statusDiv = document.getElementById('status');
    const sourceDirectory = document.getElementById('sourceDirectoryPath').value;
    if (!sourceDirectory) { alert("Veuillez sélectionner un dossier de fichiers TXT."); return; }
    
    const isAutoDetectMode = document.getElementById('globalAutoDetectSwitch').checked;
    let configJSON = "{}"; 
    if (!isAutoDetectMode) {
      const currentConfig = getCurrentConfiguration("current_run");
      if (currentConfig.columns.length === 0) { alert("Veuillez définir au moins une colonne à extraire ou activer l'auto-détection."); return; }
      configJSON = JSON.stringify(currentConfig);
    }
    statusDiv.textContent = isAutoDetectMode ? "Recherche des profils..." : "Traitement en cours...";
    try {
        const message = await ProcessFiles(configJSON, sourceDirectory, isAutoDetectMode);
        statusDiv.textContent = message;
        showAlert('success', message);
    } catch (err) { 
        statusDiv.textContent = `Erreur : ${err}`; 
        showAlert('warning', `Une erreur est survenue : ${err}`);
    }
}
function allowDrop(ev) { ev.preventDefault(); }
function drop(ev) {
    ev.preventDefault();
    const dropZone = ev.target.closest('.droppable');
    if (!dropZone) return;
    const data = JSON.parse(ev.dataTransfer.getData("application/json"));
    const tag = createConfigurableTag(data.text, data.index, true, data.color);
    if(dropZone.id !== 'extractZone') tag.querySelector('.column-name-input').style.display = 'none';
    dropZone.appendChild(tag);
    if (dropZone.id === 'extractZone') updateCsvPreview();
}
function createConfigurableTag(text, originalIndex, isForExtract, color) {
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.dataset.originalIndex = originalIndex;
    tag.dataset.prefixTrim = "0"; tag.dataset.suffixTrim = "0";
    tag.style.backgroundColor = color || "#5a5c69";
    
    const textSpan = document.createElement('span');
    textSpan.textContent = text;
    textSpan.className = 'original-text';
    tag.appendChild(textSpan);
    
    if (isForExtract) {
        const columnNameInput = document.createElement('input');
        columnNameInput.type = 'text';
        columnNameInput.className = 'column-name-input';
        columnNameInput.placeholder = 'Nom colonne...';
        columnNameInput.value = text.substring(0,20);
        columnNameInput.onclick = (e) => e.stopPropagation();
        columnNameInput.oninput = updateCsvPreview;
        tag.appendChild(columnNameInput);

        const config = document.createElement('span');
        config.textContent = '⚙️'; config.title = "Rognage"; config.style.cursor = "pointer"; config.style.marginLeft="4px";
        
        const settings = document.createElement('div');
        settings.className = 'tag-settings';
        settings.innerHTML = `<button class="close-settings" title="Fermer">×</button><label>Début</label><input type="number" value="0" min="0" class="trim-input-prefix"><label>Fin</label><input type="number" value="0" min="0" class="trim-input-suffix">`;
        
        config.onclick = (e) => { e.stopPropagation(); settings.style.display = settings.style.display === "flex" ? "none" : "flex"; };
        settings.querySelector('.close-settings').onclick = (e) => { e.stopPropagation(); settings.style.display = 'none'; };
        
        const prefixInput = settings.querySelector('.trim-input-prefix');
        const suffixInput = settings.querySelector('.trim-input-suffix');
        const updateTrim = () => {
            const prefix = parseInt(prefixInput.value) || 0;
            const suffix = parseInt(suffixInput.value) || 0;
            tag.dataset.prefixTrim = prefix; tag.dataset.suffixTrim = suffix;
            const originalText = previewData[parseInt(tag.dataset.originalIndex)] || '';
            textSpan.textContent = applyTrim(originalText, prefix, suffix);
            updateCsvPreview();
        };
        prefixInput.addEventListener('input', updateTrim);
        suffixInput.addEventListener('input', updateTrim);
        
        tag.appendChild(config);
        tag.appendChild(settings);
    }
    const close = document.createElement('span');
    close.textContent = '✖'; close.title = "Supprimer";  close.style.cursor = "pointer"; close.style.marginLeft="4px";
    close.onclick = () => { tag.remove(); updateCsvPreview(); };
    tag.appendChild(close);
    
    return tag;
}
function updateCsvPreview() {
    const previewDiv = document.getElementById('csvPreview');
    const config = getCurrentConfiguration("preview");
    if (config.columns.length === 0 || previewData.length === 0) {
        previewDiv.innerHTML = '<span class="text-muted">(Configurez des colonnes et un fichier test)</span>'; return;
    }
    const headers = config.columns.map(col => `"${col.columnName.replace(/"/g, '""')}"`);
    const dataRowParts = config.columns.map(colConfig => {
        let cellValue;
        if (colConfig.isFusion) {
            const parts = colConfig.fusionRule.parts.map(part => applyTrim(previewData[part.originalIndex] || '', part.prefix, part.suffix));
            cellValue = parts.join(colConfig.fusionRule.separator);
        } else {
            cellValue = applyTrim(previewData[colConfig.originalIndex] || '', colConfig.prefixTrim, colConfig.suffixTrim);
        }
        return `"${cellValue.replace(/"/g, '""')}"`;
    });
    previewDiv.innerHTML = `<pre>${headers.join(';')}\n${dataRowParts.join(';')}</pre>`;
}
async function selectSourceDirectory() {
    try {
        const dirPath = await SelectDirectory();
        if (dirPath) document.getElementById('sourceDirectoryPath').value = dirPath;
    } catch (err) { console.error("Erreur sélection dossier:", err); }
}
async function initApp() {
    document.getElementById('browseTestFileBtn').addEventListener('click', handleTestFileSelection);
    document.getElementById('autoDetectEnabledSwitch').addEventListener('change', (e) => {
        document.getElementById('autoDetectOptions').classList.toggle('d-none', !e.target.checked);
    });
    document.getElementById('separator').addEventListener('change', parseAndDisplayTestPreview);
    document.getElementById('browseBtn').addEventListener('click', selectSourceDirectory);
    document.getElementById('saveProfileBtn').addEventListener('click', handleSaveProfile);
    document.getElementById('loadProfileBtn').addEventListener('click', handleLoadProfile);
    document.getElementById('deleteProfileBtn').addEventListener('click', handleDeleteProfile);
    document.getElementById('createFusionBtn').addEventListener('click', createFusion);
    document.getElementById('processFilesBtn').addEventListener('click', processFiles);
    const extractZone = document.getElementById('extractZone');
    const fusionZone = document.getElementById('fusionZone');
    extractZone.addEventListener('drop', drop);
    extractZone.addEventListener('dragover', allowDrop);
    fusionZone.addEventListener('drop', drop);
    fusionZone.addEventListener('dragover', allowDrop);
    document.getElementById('recursiveSwitch').addEventListener('change', (e) => {
        document.getElementById('outputModeOptions').classList.toggle('d-none', !e.target.checked);
    });
    await updateProfileListUI();
    updateCsvPreview();
}
document.addEventListener('DOMContentLoaded', initApp);
// --- FIN DU FICHIER main.js. ---