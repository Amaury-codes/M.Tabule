// --- DEBUT DU FICHIER app.go ---

package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx context.Context
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// --- Structures ---
type ProfileConfig struct {
	Name              string         `json:"name"`
	Separator         string         `json:"separator"`
	Columns           []ColumnConfig `json:"columns"`
	Recursive         bool           `json:"recursive"`
	OutputMode        string         `json:"outputMode"`
	SaveLocation      string         `json:"saveLocation"`
	AutoDetectEnabled bool           `json:"autoDetectEnabled"`
	AutoDetectIndex   int            `json:"autoDetectIndex"`
	AutoDetectValue   string         `json:"autoDetectValue"`
}
type ColumnConfig struct {
	IsFusion      bool        `json:"isFusion"`
	ColumnName    string      `json:"columnName"`
	OriginalText  string      `json:"originalText"`
	FusionRule    *FusionRule `json:"fusionRule,omitempty"`
	OriginalIndex int         `json:"originalIndex"`
	PrefixTrim    int         `json:"prefixTrim"`
	SuffixTrim    int         `json:"suffixTrim"`
}
type FusionRule struct {
	Separator string       `json:"separator"`
	Parts     []FusionPart `json:"parts"`
}
type FusionPart struct {
	OriginalIndex int `json:"originalIndex"`
	Prefix        int `json:"prefix"`
	Suffix        int `json:"suffix"`
}
type BackendResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
}

// --- GESTION DES PROFILS ---
func getProfilesDir() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil { return "", err }
	profilesPath := filepath.Join(configDir, "TxtCsvExtractor", "profiles")
	if err := os.MkdirAll(profilesPath, 0755); err != nil { return "", err }
	return profilesPath, nil
}
func sanitizeProfileName(profileName string) (string, error) {
	name := strings.TrimSpace(profileName)
	if name == "" { return "", fmt.Errorf("le nom du profil ne peut pas être vide") }
	if strings.ContainsAny(name, `.\/:*?"<>|`) { return "", fmt.Errorf("le nom du profil contient des caractères invalides") }
	return name, nil
}
func (a *App) ListProfiles() ([]string, error) {
	profilesDir, err := getProfilesDir()
	if err != nil { return make([]string, 0), err }
	files, err := ioutil.ReadDir(profilesDir)
	if err != nil { return make([]string, 0), err }
	profileNames := make([]string, 0)
	for _, file := range files {
		if !file.IsDir() && strings.HasSuffix(file.Name(), ".json") {
			profileNames = append(profileNames, strings.TrimSuffix(file.Name(), ".json"))
		}
	}
	return profileNames, nil
}
func (a *App) SaveProfile(profileJSON string) error {
	var config ProfileConfig
	if err := json.Unmarshal([]byte(profileJSON), &config); err != nil { return fmt.Errorf("JSON invalide: %w", err) }
	sanitizedName, err := sanitizeProfileName(config.Name)
	if err != nil { return err }
	profilesDir, err := getProfilesDir()
	if err != nil { return err }
	filePath := filepath.Join(profilesDir, sanitizedName+".json")
	return ioutil.WriteFile(filePath, []byte(profileJSON), 0644)
}
func (a *App) LoadProfile(profileName string) (string, error) {
	sanitizedName, err := sanitizeProfileName(profileName)
	if err != nil { return "", err }
	profilesDir, err := getProfilesDir()
	if err != nil { return "", err }
	filePath := filepath.Join(profilesDir, sanitizedName+".json")
	content, err := ioutil.ReadFile(filePath)
	if err != nil { return "", fmt.Errorf("impossible de lire le profil '%s': %w", profileName, err) }
	return string(content), nil
}
func (a *App) DeleteProfile(profileName string) BackendResponse {
	sanitizedName, err := sanitizeProfileName(profileName)
	if err != nil { return BackendResponse{Success: false, Message: err.Error()} }
	profilesDir, err := getProfilesDir()
	if err != nil { return BackendResponse{Success: false, Message: "Erreur critique : impossible d'accéder au dossier des profils."} }
	filePath := filepath.Join(profilesDir, sanitizedName+".json")
	if _, err := os.Stat(filePath); os.IsNotExist(err) { return BackendResponse{Success: false, Message: fmt.Sprintf("Le profil '%s' n'existe pas.", sanitizedName)} }
	err = os.Remove(filePath)
	if err != nil { return BackendResponse{Success: false, Message: fmt.Sprintf("Erreur lors de la suppression: %v", err)} }
	return BackendResponse{Success: true, Message: fmt.Sprintf("Le profil '%s' a été supprimé.", sanitizedName)}
}

// --- Fonctions publiques de l'application ---
func (a *App) SelectAndReadTestFile() (string, error) {
	filePath, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title:   "Sélectionnez un fichier TXT de test",
		Filters: []runtime.FileFilter{{DisplayName: "Fichiers Texte (*.txt)", Pattern: "*.txt"}},
	})
	if err != nil || filePath == "" { return "", err }
	content, err := os.ReadFile(filePath)
	if err != nil { return "", fmt.Errorf("impossible de lire le fichier: %w", err) }
	return string(content), nil
}
func (a *App) ConfirmDialog(title, message string) (string, error) {
	return runtime.MessageDialog(a.ctx, runtime.MessageDialogOptions{
		Type: runtime.QuestionDialog, Title: title, Message: message,
		Buttons: []string{"Supprimer", "Annuler"}, CancelButton: "Annuler",
	})
}
func (a *App) SelectDirectory() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "Sélectionnez le dossier des fichiers TXT"})
}

// --- Logique de Traitement (CORRIGÉE) ---
func (a *App) ProcessFiles(configJSON, sourceDirectory string, isAutoDetectMode bool) (string, error) {
	if !isAutoDetectMode {
		var config ProfileConfig
		if err := json.Unmarshal([]byte(configJSON), &config); err != nil { return "", err }
		return a.processWithSingleProfile(sourceDirectory, &config)
	}

	runtime.LogInfo(a.ctx, "Mode auto-détection activé.")
	allProfileNames, err := a.ListProfiles()
	if err != nil { return "", err }

	var allProfiles []ProfileConfig
	for _, name := range allProfileNames {
		profileJson, _ := a.LoadProfile(name)
		var p ProfileConfig
		if json.Unmarshal([]byte(profileJson), &p) == nil && p.AutoDetectEnabled && p.AutoDetectValue != "" {
			allProfiles = append(allProfiles, p)
		}
	}
	if len(allProfiles) == 0 { return "Mode auto-détection activé, mais aucun profil compatible trouvé.", nil }
	
	var dirsToProcess []string
	if err := filepath.Walk(sourceDirectory, func(path string, info os.FileInfo, err error) error {
		if err != nil { return err }
		if info.IsDir() {
			if has, _ := directoryContainsTxt(path); has { dirsToProcess = append(dirsToProcess, path) }
		}
		return nil
	}); err != nil { return "", err }
	if len(dirsToProcess) == 0 { return "Aucun dossier avec des fichiers .txt trouvé.", nil }
	
	var report strings.Builder
	processedCount := 0
	for _, dir := range dirsToProcess {
		baseDir := filepath.Base(dir)
		assignedProfile := a.findProfileForDir(dir, allProfiles)
		if assignedProfile == nil {
			report.WriteString(fmt.Sprintf("\n- Dossier '%s': Aucun profil trouvé, ignoré.", baseDir))
			continue
		}
		
		tempConfig := *assignedProfile
		tempConfig.SaveLocation = "source" // FORCE LA SAUVEGARDE LOCALE DANS CE MODE
		
		report.WriteString(fmt.Sprintf("\n- Dossier '%s': Profil '%s' appliqué.", baseDir, tempConfig.Name))
		_, err := a.processSingleDirectory(dir, &tempConfig)
		if err == nil {
			processedCount++
		}
	}
	return fmt.Sprintf("Traitement par auto-détection terminé. %d dossiers traités. Rapport:%s", processedCount, report.String()), nil
}

func (a *App) processWithSingleProfile(sourceDir string, config *ProfileConfig) (string, error) {
	if !config.Recursive {
		return a.processSingleDirectory(sourceDir, config)
	}
	
	var dirsWithTxt []string
	filepath.Walk(sourceDir, func(path string, info os.FileInfo, err error) error {
		if err != nil { return err }
		if info.IsDir() {
			if has, _ := directoryContainsTxt(path); has { dirsWithTxt = append(dirsWithTxt, path) }
		}
		return nil
	})
	if len(dirsWithTxt) == 0 { return "Aucun fichier .txt trouvé dans les sous-dossiers.", nil }
	
	if config.OutputMode == "single" {
		var allContent strings.Builder
		allContent.WriteString(a.generateCsvHeader(config))

		for _, dir := range dirsWithTxt {
			csvData, _ := a.generateCsvForDirectory(dir, config)
			allContent.WriteString(csvData)
		}
		return a.saveCsvContent(allContent.String(), "export_complet.csv", sourceDir, config)
	}

	for _, dir := range dirsWithTxt {
		tempConfig := *config
		tempConfig.SaveLocation = "source" // FORCE LA SAUVEGARDE LOCALE EN MODE MULTIPLE
		a.processSingleDirectory(dir, &tempConfig)
	}
	return fmt.Sprintf("%d sous-dossiers traités.", len(dirsWithTxt)), nil
}

func (a *App) processSingleDirectory(dirPath string, config *ProfileConfig) (string, error) {
    csvData, err := a.generateCsvForDirectory(dirPath, config)
    if err != nil { return "", err }
    if csvData == "" { return fmt.Sprintf("Aucune donnée à extraire dans %s.", dirPath), nil }
	
	header := a.generateCsvHeader(config)
	return a.saveCsvContent(header+csvData, "export.csv", dirPath, config)
}

func (a *App) generateCsvForDirectory(dirPath string, config *ProfileConfig) (string, error) {
	var csvBuilder strings.Builder
	files, err := os.ReadDir(dirPath)
	if err != nil { return "", err }

	for _, file := range files {
		if file.IsDir() || !strings.HasSuffix(strings.ToLower(file.Name()), ".txt") { continue }
		filePath := filepath.Join(dirPath, file.Name())
		content, _ := os.ReadFile(filePath)
		lines := strings.Split(string(content), "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" { continue }
			data := strings.Split(line, config.Separator)
			var csvRow []string
			for _, colConfig := range config.Columns {
				var cellValue string
				if colConfig.IsFusion {
					var parts []string
					for _, part := range colConfig.FusionRule.Parts {
						rawValue := ""; if part.OriginalIndex < len(data) { rawValue = data[part.OriginalIndex] }
						parts = append(parts, applyTrim(rawValue, part.Prefix, part.Suffix))
					}
					cellValue = strings.Join(parts, colConfig.FusionRule.Separator)
				} else {
					rawValue := ""; if colConfig.OriginalIndex < len(data) { rawValue = data[colConfig.OriginalIndex] }
					cellValue = applyTrim(rawValue, colConfig.PrefixTrim, colConfig.SuffixTrim)
				}
				csvRow = append(csvRow, fmt.Sprintf(`"%s"`, strings.ReplaceAll(cellValue, `"`, `""`)))
			}
			csvBuilder.WriteString(strings.Join(csvRow, ";") + "\r\n")
		}
	}
	return csvBuilder.String(), nil
}

func (a *App) findProfileForDir(dirPath string, profiles []ProfileConfig) *ProfileConfig {
	firstTxtPath, err := findFirstTxtInDir(dirPath)
	if err != nil { return nil }
	file, err := os.Open(firstTxtPath); if err != nil { return nil }
	defer file.Close()
	scanner := bufio.NewScanner(file)
	if scanner.Scan() {
		firstLine := scanner.Text()
		for _, p := range profiles {
			parts := strings.Split(firstLine, p.Separator)
			if p.AutoDetectIndex >= 0 && p.AutoDetectIndex < len(parts) {
				if strings.Contains(parts[p.AutoDetectIndex], p.AutoDetectValue) {
					profileCopy := p
					return &profileCopy
				}
			}
		}
	}
	return nil
}

// --- Fonctions utilitaires Go (Helpers) ---
func findFirstTxtInDir(dirPath string) (string, error) {
    entries, err := os.ReadDir(dirPath)
    if err != nil { return "", err }
    for _, entry := range entries {
        if !entry.IsDir() && strings.HasSuffix(strings.ToLower(entry.Name()), ".txt") {
            return filepath.Join(dirPath, entry.Name()), nil
        }
    }
    return "", fmt.Errorf("aucun fichier txt trouvé dans %s", dirPath)
}
func directoryContainsTxt(dirPath string) (bool, error) {
	_, err := findFirstTxtInDir(dirPath)
	return err == nil, nil
}
func applyTrim(text string, prefix, suffix int) string {
	if prefix > 0 && len(text) > prefix { text = text[prefix:] }
	if suffix > 0 && len(text) > suffix { text = text[:len(text)-suffix] }
	return strings.TrimSpace(text)
}
func (a *App) saveCsvContent(content, defaultName, sourcePath string, config *ProfileConfig) (string, error) {
	var savePath string
	var err error

	if config.SaveLocation == "source" {
		savePath = filepath.Join(sourcePath, defaultName)
	} else {
		savePath, err = runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
			DefaultFilename: defaultName,
			Title:           "Enregistrer le fichier CSV",
			Filters:         []runtime.FileFilter{{DisplayName: "Fichiers CSV (*.csv)", Pattern: "*.csv"}},
		})
		if err != nil { return "", err }
		if savePath == "" { return "Sauvegarde annulée.", nil }
	}
	if err := os.WriteFile(savePath, []byte(content), 0644); err != nil { return "", fmt.Errorf("impossible d'enregistrer le fichier : %w", err) }
	return fmt.Sprintf("Fichier enregistré : %s", savePath), nil
}
func (a *App) generateCsvHeader(config *ProfileConfig) string {
	var headers []string
	for _, col := range config.Columns {
		headers = append(headers, fmt.Sprintf(`"%s"`, strings.ReplaceAll(col.ColumnName, `"`, `""`)))
	}
	return "\uFEFF" + strings.Join(headers, ";") + "\r\n"
}
// --- FIN DU FICHIER app.go. ---