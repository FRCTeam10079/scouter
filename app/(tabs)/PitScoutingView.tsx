import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';

// CONFIG
// API URL is now passed in as a prop
// const API_URL = 'http://192.168.1.55:8000'; 

export default function PitScoutingView({ onBack, username, token, apiUrl }: any) {
  const [loading, setLoading] = useState(false);
  const [viewingSaved, setViewingSaved] = useState(false);
  const [savedReports, setSavedReports] = useState<any[]>([]);
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  const [teamInput, setTeamInput] = useState('');
  const [printLayout, setPrintLayout] = useState<'expanded' | 'compact'>('expanded');
  const [form, setForm] = useState({
    teamNumber: '',
    drivetrain: 'Swerve', // Default
    shooter: 'Single Shooter', // Default
    hasDrumShooter: false,
    estimatedBps: '',
    driverExperience: '',
    weight: '',
    width: '',
    length: '',
    autoRoutines: '',
    canFerry: false,
    canClimb: false,
    climbLevels: [] as number[],
    notes: '',
    photoBase64: ''
  });

  const loadReports = async () => {
    try {
      const data = await AsyncStorage.getItem('@local_pit_reports');
      if (data) setSavedReports(JSON.parse(data));
      else setSavedReports([]);
    } catch (e) {}
  };

  useEffect(() => {
    loadReports();
  }, []);

  const pickImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.3,
      base64: true,
    });

    if (!result.canceled && result.assets && result.assets[0].base64) {
      setForm({ ...form, photoBase64: result.assets[0].base64 });
    }
  };

  const handleSave = async () => {
    if (!form.teamNumber) return Alert.alert("Error", "Enter Team Number");

    setLoading(true);

    try {
      const newReport = {
        id: Date.now().toString(),
        createdAt: new Date().toISOString(),
        ...form
      };

      const existingData = await AsyncStorage.getItem('@local_pit_reports');
      const allReports = existingData ? JSON.parse(existingData) : [];
      
      const idx = allReports.findIndex((r: any) => r.teamNumber === newReport.teamNumber);
      if (idx >= 0) allReports[idx] = newReport; // overwrite
      else allReports.unshift(newReport);
      
      await AsyncStorage.setItem('@local_pit_reports', JSON.stringify(allReports));
      setSavedReports(allReports);

      Alert.alert("Success", `Local Pit Data for Team ${form.teamNumber} saved!`);
      // Reset Form
      setForm({ ...form, teamNumber: '', hasDrumShooter: false, estimatedBps: '', driverExperience: '', weight: '', width: '', length: '', autoRoutines: '', notes: '', photoBase64: '', canFerry: false, climbLevels: [] });
    } catch (e) {
      Alert.alert("Error", "Could not save pit report locally.");
    }
    setLoading(false);
  };

  const escapeHtml = (value: string) =>
    String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const parseTeamNumbers = (value: string) => {
    const teams = value
      .split(',')
      .map((team) => team.trim())
      .filter(Boolean);

    return Array.from(new Set(teams));
  };

  const climbLevelLabel = (report: any) => {
    if (!report.canClimb) return 'No';
    if (!report.climbLevels || report.climbLevels.length === 0) return 'Yes';
    return `Yes (L${report.climbLevels.join(', L')})`;
  };

  const buildCompactRow = (report: any) => `
    <tr>
      <td>${escapeHtml(report.teamNumber || 'N/A')}</td>
      <td>${escapeHtml(report.drivetrain || 'N/A')}</td>
      <td>${escapeHtml(report.shooter || 'N/A')}</td>
      <td>${report.hasDrumShooter ? 'Yes' : 'No'}</td>
      <td>${escapeHtml(report.estimatedBps || '?')}</td>
      <td>${escapeHtml(report.driverExperience || '?')}</td>
      <td>${report.canFerry ? 'Yes' : 'No'}</td>
      <td>${escapeHtml(climbLevelLabel(report))}</td>
      <td>${escapeHtml(report.weight || '?')} / ${escapeHtml(report.width || '?')} / ${escapeHtml(report.length || '?')}</td>
      <td>${escapeHtml(report.autoRoutines || '-')}</td>
      <td>${escapeHtml(report.notes || '-')}</td>
    </tr>
  `;

  const buildDetailedCard = (report: any) => `
    <section class="report-card page-break">
      <h2>Team ${escapeHtml(report.teamNumber || 'N/A')}</h2>
      <div class="meta">Created: ${escapeHtml(new Date(report.createdAt || Date.now()).toLocaleString())}</div>

      <div class="grid">
        <div class="box"><div class="label">Drivetrain</div><div class="value">${escapeHtml(report.drivetrain || 'N/A')}</div></div>
        <div class="box"><div class="label">Shooter</div><div class="value">${escapeHtml(report.shooter || 'N/A')}</div></div>
        <div class="box"><div class="label">Drum Shooter</div><div class="value">${report.hasDrumShooter ? 'Yes' : 'No'}</div></div>
        <div class="box"><div class="label">Estimated BPS</div><div class="value">${escapeHtml(report.estimatedBps || '?')}</div></div>
        <div class="box"><div class="label">Driver Experience</div><div class="value">${escapeHtml(report.driverExperience || '?')} events</div></div>
        <div class="box"><div class="label">Can Ferry</div><div class="value">${report.canFerry ? 'Yes' : 'No'}</div></div>
        <div class="box"><div class="label">Climb</div><div class="value">${escapeHtml(climbLevelLabel(report))}</div></div>
      </div>

      <div class="box full-width">
        <div class="label">Physical Specs</div>
        <div class="value">Weight: ${escapeHtml(report.weight || '?')} lbs | Width: ${escapeHtml(report.width || '?')} in | Length: ${escapeHtml(report.length || '?')} in</div>
      </div>

      <div class="box full-width">
        <div class="label">Auto Routines</div>
        <div class="value text">${escapeHtml(report.autoRoutines || 'None provided')}</div>
      </div>

      <div class="box full-width">
        <div class="label">General Notes</div>
        <div class="value text">${escapeHtml(report.notes || 'No notes provided')}</div>
      </div>

      ${report.photoBase64 ? `<img src="data:image/jpeg;base64,${report.photoBase64}" />` : ''}
    </section>
  `;

  const printReports = async (reportsToPrint: any[]) => {
    if (!reportsToPrint.length) {
      Alert.alert('No Teams Selected', 'Choose at least one team before printing.');
      return;
    }

    try {
      const compactRows = reportsToPrint.map(buildCompactRow).join('');
      const detailedCards = reportsToPrint.map(buildDetailedCard).join('');

      const html = `
      <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; color: #111; }
            h1 { margin: 0 0 8px; font-size: 30px; }
            .subtitle { color: #444; margin-bottom: 18px; }
            .chip { display: inline-block; background: #0a84ff; color: #fff; padding: 6px 12px; border-radius: 999px; font-size: 12px; margin-bottom: 14px; }
            .grid { display: flex; gap: 12px; flex-wrap: wrap; margin: 14px 0; }
            .box { border: 1px solid #d9d9d9; border-radius: 10px; padding: 12px; min-width: 170px; flex: 1; background: #fafafa; }
            .full-width { width: 100%; margin-top: 10px; }
            .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; color: #5c5c5c; margin-bottom: 5px; font-weight: 700; }
            .value { font-size: 16px; font-weight: 700; color: #1a1a1a; }
            .text { font-size: 14px; font-weight: 500; line-height: 1.4; white-space: pre-wrap; }
            .meta { margin-bottom: 10px; color: #555; font-size: 12px; }
            .report-card { margin-top: 10px; }
            img { max-width: 100%; max-height: 320px; object-fit: contain; border-radius: 8px; margin-top: 14px; border: 1px solid #ddd; }
            .page-break { page-break-after: always; }
            .page-break:last-child { page-break-after: auto; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
            th, td { border: 1px solid #d8d8d8; padding: 8px; text-align: left; vertical-align: top; }
            th { background: #f2f2f2; font-size: 11px; text-transform: uppercase; }
          </style>
        </head>
        <body>
          <h1>Pit Scouting Report</h1>
          <div class="subtitle">Teams: ${reportsToPrint.map((r) => escapeHtml(r.teamNumber || '')).join(', ')}</div>
          <div class="chip">${printLayout === 'compact' ? 'Compact View' : 'Detailed View'}</div>
          ${
            printLayout === 'compact'
              ? `
            <table>
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Drivetrain</th>
                  <th>Shooter</th>
                  <th>Drum</th>
                  <th>Est BPS</th>
                  <th>Driver Exp</th>
                  <th>Can Ferry</th>
                  <th>Climb</th>
                  <th>Wgt/W/L</th>
                  <th>Auto</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                ${compactRows}
              </tbody>
            </table>
          `
              : detailedCards
          }
        </body>
      </html>`;
      
      if (Platform.OS === 'web') {
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
          Alert.alert('Popup Blocked', 'Allow popups to print on web.');
          return;
        }

        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => printWindow.print(), 300);
        return;
      }

      // Generate a real PDF from HTML first so users get report content (not a UI snapshot).
      const { uri } = await Print.printToFileAsync({ html });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Share Pit Scouting Report PDF',
          UTI: 'com.adobe.pdf',
        });
      } else {
        await Print.printAsync({ html });
      }
    } catch (error: any) {
      console.error("Print Error: ", error);
      Alert.alert('Error', `Failed to print the document. ${error.message}`);
    }
  };

  const syncTeamInput = (teams: string[]) => {
    setSelectedTeams(teams);
    setTeamInput(teams.join(', '));
  };

  const toggleTeamSelection = (teamNumber: string) => {
    const normalizedTeam = teamNumber.trim();
    const teamSet = new Set(selectedTeams);

    if (teamSet.has(normalizedTeam)) teamSet.delete(normalizedTeam);
    else teamSet.add(normalizedTeam);

    syncTeamInput(Array.from(teamSet));
  };

  const onTeamInputChange = (value: string) => {
    setTeamInput(value);
    setSelectedTeams(parseTeamNumbers(value));
  };

  const selectedReports =
    selectedTeams.length > 0
      ? savedReports.filter((report) => selectedTeams.includes(report.teamNumber))
      : savedReports;

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={onBack}><Text style={styles.backLink}>← Dashboard</Text></TouchableOpacity>
        <Text style={styles.headerTitle}>Pit Scouting</Text>
        <TouchableOpacity style={styles.toggleBtn} onPress={() => setViewingSaved(!viewingSaved)}>
          <Text style={styles.saveText}>{viewingSaved ? "Back to Form" : "View Saved Reports"}</Text>
        </TouchableOpacity>
        <View style={{width: 40}} /> 
      </View>

      {viewingSaved ? (
        <View>
          <Text style={{color: '#fff', fontSize: 18, marginBottom: 10}}>Local Pit Reports</Text>
          <Text style={styles.helperText}>Choose teams: 254, 1678, 118</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter team numbers separated by commas"
            placeholderTextColor="#666"
            value={teamInput}
            onChangeText={onTeamInputChange}
          />

          <View style={styles.layoutRow}>
            <TouchableOpacity
              style={[styles.layoutBtn, printLayout === 'expanded' && styles.activeBtn]}
              onPress={() => setPrintLayout('expanded')}
            >
              <Text style={[styles.btnText, printLayout === 'expanded' && styles.activeText]}>Detailed View</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.layoutBtn, printLayout === 'compact' && styles.activeBtn]}
              onPress={() => setPrintLayout('compact')}
            >
              <Text style={[styles.btnText, printLayout === 'compact' && styles.activeText]}>Compact View</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.printSelectedBtn}
            onPress={() => printReports(selectedReports)}
          >
            <Text style={styles.printSelectedText}>
              Print {selectedReports.length} Team{selectedReports.length === 1 ? '' : 's'} ({printLayout === 'compact' ? 'Compact' : 'Detailed'})
            </Text>
          </TouchableOpacity>

          {savedReports.length === 0 && <Text style={{color: '#888'}}>No reports saved yet.</Text>}
          {savedReports.map((r, i) => (
            <View key={i} style={{backgroundColor: '#1e1e1e', padding: 15, borderRadius: 10, marginBottom: 15, borderWidth: 1, borderColor: '#333'}}>
              <View style={styles.teamRow}>
                <Text style={{color: '#fff', fontSize: 20, fontWeight: 'bold'}}>Team {r.teamNumber}</Text>
                <TouchableOpacity
                  style={[styles.pickBtn, selectedTeams.includes(r.teamNumber) && styles.activeBtn]}
                  onPress={() => toggleTeamSelection(r.teamNumber)}
                >
                  <Text style={[styles.btnText, selectedTeams.includes(r.teamNumber) && styles.activeText]}>
                    {selectedTeams.includes(r.teamNumber) ? 'Picked' : 'Pick Team'}
                  </Text>
                </TouchableOpacity>
              </View>
              <Text style={{color: '#aaa', marginTop: 5}}>Drive: {r.drivetrain} | Shooter: {r.shooter}</Text>
              <Text style={{color: '#aaa'}}>Drum Shooter: {r.hasDrumShooter ? 'Yes' : 'No'}</Text>
              <Text style={{color: '#aaa'}}>Estimated BPS: {r.estimatedBps || '?'} | Driver Exp: {r.driverExperience || '?'} events</Text>
              <Text style={{color: '#aaa'}}>Can Ferry: {r.canFerry ? 'Yes' : 'No'}</Text>
              <Text style={{color: '#aaa'}}>Climb: {r.canClimb ? "Yes" : "No"} {r.climbLevels && r.climbLevels.length > 0 ? `(L${r.climbLevels.join(', L')})` : ''}</Text>
              <Text style={{color: '#aaa', fontStyle: 'italic', marginTop: 5}}>{r.notes}</Text>
              {r.photoBase64 ? (
                <Image source={{ uri: `data:image/jpeg;base64,${r.photoBase64}` }} style={{ width: '100%', height: 200, marginTop: 10, borderRadius: 8, resizeMode: 'cover' }} />
              ) : null}
              <TouchableOpacity style={{ backgroundColor: '#ff9500', padding: 10, borderRadius: 6, marginTop: 10, alignItems: 'center' }} onPress={() => printReports([r])}>
                <Text style={{ color: '#fff', fontWeight: 'bold' }}>Print Report ({printLayout === 'compact' ? 'Compact' : 'Detailed'})</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : (
      <View style={styles.card}>
        <Text style={styles.label}>Team Number</Text>
        <TextInput 
          style={[styles.input, {fontSize: 24, fontWeight: 'bold'}]} 
          keyboardType="numeric" 
          placeholder="254" 
          placeholderTextColor="#666"
          value={form.teamNumber}
          onChangeText={t => setForm({...form, teamNumber: t})}
        />

        <Text style={styles.label}>Drivetrain Type</Text>
        <View style={styles.row}>
          {['Swerve', 'Tank', 'Mecanum'].map(type => (
            <TouchableOpacity 
              key={type} 
              style={[styles.optionBtn, form.drivetrain === type && styles.activeBtn]}
              onPress={() => setForm({...form, drivetrain: type})}
            >
              <Text style={[styles.btnText, form.drivetrain === type && styles.activeText]}>{type}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Shooter Type</Text>
        <View style={styles.row}>
          {['Single Shooter', 'Dual Shooter', 'Triple Shooter', 'Turret'].map(type => (
            <TouchableOpacity 
              key={type} 
              style={[styles.optionBtn, form.shooter === type && styles.activeBtn]}
              onPress={() => setForm({...form, shooter: type})}
            >
              <Text style={[styles.btnText, form.shooter === type && styles.activeText]}>{type}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.toggleBtn, form.hasDrumShooter && styles.activeGreen]}
          onPress={() => setForm({...form, hasDrumShooter: !form.hasDrumShooter})}
        >
          <Text style={styles.toggleText}>Do they have a Drum Shooter? {form.hasDrumShooter ? "YES" : "NO"}</Text>
        </TouchableOpacity>

        <Text style={styles.label}>Estimated BPS</Text>
        <TextInput
          style={styles.input}
          keyboardType="numeric"
          placeholder="e.g. 6.5"
          placeholderTextColor="#666"
          value={form.estimatedBps}
          onChangeText={t => setForm({...form, estimatedBps: t})}
        />

        <Text style={styles.label}>Driver Experience (Events Gone To)</Text>
        <TextInput
          style={styles.input}
          keyboardType="numeric"
          placeholder="e.g. 4"
          placeholderTextColor="#666"
          value={form.driverExperience}
          onChangeText={t => setForm({...form, driverExperience: t})}
        />

        <Text style={styles.label}>Physical Specs</Text>
        <View style={styles.row}>
          <TextInput style={[styles.input, {flex:1}]} placeholder="Weight (lbs)" placeholderTextColor="#666" keyboardType="numeric" value={form.weight} onChangeText={t => setForm({...form, weight: t})} />
          <TextInput style={[styles.input, {flex:1}]} placeholder="Width (in)" placeholderTextColor="#666" keyboardType="numeric" value={form.width} onChangeText={t => setForm({...form, width: t})} />
          <TextInput style={[styles.input, {flex:1}]} placeholder="Length (in)" placeholderTextColor="#666" keyboardType="numeric" value={form.length} onChangeText={t => setForm({...form, length: t})} />
        </View>

        <Text style={styles.label}>Capabilities</Text>
        <TouchableOpacity 
          style={[styles.toggleBtn, form.canClimb && styles.activeGreen]}
          onPress={() => setForm({...form, canClimb: !form.canClimb, climbLevels: form.canClimb ? [] : form.climbLevels})}
        >
          <Text style={styles.toggleText}>Can they Climb? {form.canClimb ? "YES" : "NO"}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.toggleBtn, form.canFerry && styles.activeGreen]}
          onPress={() => setForm({...form, canFerry: !form.canFerry})}
        >
          <Text style={styles.toggleText}>Are they able to Ferry? {form.canFerry ? "YES" : "NO"}</Text>
        </TouchableOpacity>

        {form.canClimb && (
          <View style={{ marginTop: 10 }}>
            <Text style={[styles.label, { marginTop: 0 }]}>Climb Levels</Text>
            <View style={styles.row}>
              {[1, 2, 3].map(level => {
                const isActive = form.climbLevels?.includes(level);
                return (
                  <TouchableOpacity 
                    key={level}
                    style={[styles.optionBtn, isActive && styles.activeBtn]}
                    onPress={() => {
                      const newLevels = isActive 
                        ? form.climbLevels.filter(l => l !== level)
                        : [...(form.climbLevels || []), level];
                      setForm({...form, climbLevels: newLevels});
                    }}
                  >
                    <Text style={[styles.btnText, isActive && styles.activeText]}>Level {level}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        <Text style={styles.label}>Auto Routines (Describe)</Text>
        <TextInput 
          style={styles.textArea} 
          multiline 
          placeholder="e.g. 3 piece, starts left..." 
          placeholderTextColor="#666"
          value={form.autoRoutines}
          onChangeText={t => setForm({...form, autoRoutines: t})}
        />

        <Text style={styles.label}>General Notes</Text>
        <TextInput 
          style={styles.textArea} 
          multiline 
          placeholder="Observations..." 
          placeholderTextColor="#666"
          value={form.notes}
          onChangeText={t => setForm({...form, notes: t})}
        />

        <Text style={styles.label}>Robot Photo</Text>
        {form.photoBase64 ? (
          <View style={{ position: 'relative' }}>
            <Image source={{ uri: `data:image/jpeg;base64,${form.photoBase64}` }} style={{ width: '100%', height: 200, borderRadius: 8, resizeMode: 'cover' }} />
            <TouchableOpacity 
              style={{ position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(0,0,0,0.6)', padding: 8, borderRadius: 20 }}
              onPress={() => setForm({ ...form, photoBase64: '' })}
            >
              <Text style={{color: '#fff', fontWeight: 'bold'}}>✕</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.optionBtn} onPress={pickImage}>
            <Text style={styles.btnText}>📷 Select Photo</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff"/> : <Text style={styles.saveText}>Save Pit Report Locally</Text>}
        </TouchableOpacity>

      </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#121212', padding: 20, paddingBottom: 40 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  backLink: { color: '#0a84ff', fontSize: 16 },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  card: { backgroundColor: '#1e1e1e', padding: 20, borderRadius: 15, borderWidth: 1, borderColor: '#333' },
  label: { color: '#aaa', marginTop: 15, marginBottom: 8, fontSize: 14 },
  input: { backgroundColor: '#2c2c2c', color: '#fff', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#444' },
  row: { flexDirection: 'row', gap: 10 },
  helperText: { color: '#8f8f8f', marginBottom: 8 },
  layoutRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  layoutBtn: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#2c2c2c', alignItems: 'center', borderWidth: 1, borderColor: '#444' },
  printSelectedBtn: { marginTop: 12, backgroundColor: '#0a84ff', padding: 12, borderRadius: 8, alignItems: 'center' },
  printSelectedText: { color: '#fff', fontWeight: '700' },
  teamRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#2c2c2c', borderWidth: 1, borderColor: '#444' },
  optionBtn: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#2c2c2c', alignItems: 'center', borderWidth: 1, borderColor: '#444' },
  activeBtn: { backgroundColor: '#0a84ff', borderColor: '#0a84ff' },
  btnText: { color: '#ccc', fontWeight: '600' },
  activeText: { color: '#fff' },
  textArea: { backgroundColor: '#2c2c2c', color: '#fff', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#444', height: 80, textAlignVertical: 'top' },
  toggleBtn: { padding: 15, borderRadius: 8, backgroundColor: '#3a2a2a', borderWidth: 1, borderColor: '#ff3b30', alignItems: 'center' },
  activeGreen: { backgroundColor: '#1a3a2a', borderColor: '#4cd964' },
  toggleText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  saveBtn: { marginTop: 30, backgroundColor: '#8a2be2', padding: 16, borderRadius: 12, alignItems: 'center' }, // Purple for Pit
  saveText: { color: '#fff', fontWeight: 'bold', fontSize: 18 }
});