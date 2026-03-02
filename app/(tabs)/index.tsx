import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import PitScoutingView from './PitScoutingView';

// App setup and configuration
// If you're testing on a real phone, remember to swap 'localhost' with your computer's local IP address
const API_URL = 'http://localhost:8000'; 

// How many matches a scouter should do before we remind them to take a break
const SHIFT_LENGTH = 12; 

// A fake schedule to simulate pulling data from The Blue Alliance.
// This auto-fills the team number so the scouters don't have to type it manually every time.
const MOCK_SCHEDULE: any = {
  "1": { "Red1": "254", "Red2": "1678", "Red3": "1323", "Blue1": "118", "Blue2": "148", "Blue3": "3310" },
  "2": { "Red1": "971", "Red2": "973", "Red3": "1690", "Blue1": "2056", "Blue2": "1114", "Blue3": "1241" },
  "3": { "Red1": "4414", "Red2": "2910", "Red3": "5985", "Blue1": "987", "Blue2": "359", "Blue3": "25" },
};

// Static lists for our UI buttons so React doesn't recreate them on every single render
const STATIONS = ['Red1', 'Red2', 'Red3', 'Blue1', 'Blue2', 'Blue3'];
const AUTO_POSITIONS = ['Left', 'Center', 'Right'];
const PASS_VOLUMES = ['None', 'Low', 'Med', 'High'];
const AUTO_WINNERS = ['Red', 'Blue', 'Tie'];
const DEFENSE_STRATEGIES = ['None', 'Hub', 'Gateway'];
const ENDGAME_ACTIONS = ['None', 'Level 2', 'Level 3', 'Failed'];

// The baseline state for a new match. We keep this here so we can easily reset the form later.
const INITIAL_MATCH_DATA: MatchData = {
  id: '', scouter: '', eventCode: '2026A', matchType: 'Qual', matchNumber: '1', teamNumber: '',
  station: 'Red1', startPos: 'Center', autoMake: 0, autoMiss: 0, autoPassVol: 'None', 
  autoClimb: 'None', autoCollect: { outpost: false, depot: false, neutral: false },
  autoWinner: 'Unknown', teleMake: 0, teleMiss: 0, teleFerry: 0, bumpCross: 0, 
  trenchCross: 0, defenseRating: '', defenseStrategy: 'None', incapacitated: false,
  endgameAction: 'None', climbTime: '', fouls: 0, notes: ''
};

// Data models
type ViewState = 'login' | 'dashboard' | 'scouting' | 'pit';
type Station = 'Red1' | 'Red2' | 'Red3' | 'Blue1' | 'Blue2' | 'Blue3';

interface MatchData {
  matchNumber: string;
  teamNumber: string;
  scouter: string;
  eventCode: string;
  matchType: 'Qual' | 'Prac' | 'Play';
  station: Station;
  startPos: 'Left' | 'Center' | 'Right';
  autoMake: number;
  autoMiss: number;
  autoPassVol: 'None' | 'Low' | 'Med' | 'High';
  autoClimb: 'None' | 'Yes' | 'Fail';
  autoCollect: { outpost: boolean; depot: boolean; neutral: boolean };
  autoWinner: 'Red' | 'Blue' | 'Tie' | 'Unknown';
  teleMake: number;
  teleMiss: number;
  teleFerry: number;
  bumpCross: number;
  trenchCross: number;
  defenseRating: string;
  defenseStrategy: 'None' | 'Hub' | 'Gateway';
  incapacitated: boolean;
  endgameAction: 'None' | 'Level 2' | 'Level 3' | 'Failed';
  climbTime: string;
  fouls: number;
  notes: string;
}

interface HistoryItem {
  id: string;
  matchNum: string;
  teamNum: string;
  qrString: string;
}

// Reusable mini-components to keep our main screen code clean
const CounterRow = ({ label, value, onChange, step = 1 }: any) => (
  <View style={styles.counterRow}>
    <Text style={styles.counterLabel}>{label}</Text>
    <View style={styles.stepper}>
      <TouchableOpacity style={[styles.btn, styles.btnMinus]} onPress={() => onChange(-step)}>
        <Text style={styles.btnText}>-</Text>
      </TouchableOpacity>
      <Text style={styles.countValue}>{value}</Text>
      <TouchableOpacity style={[styles.btn, styles.btnPlus]} onPress={() => onChange(step)}>
        <Text style={styles.btnText}>+</Text>
      </TouchableOpacity>
    </View>
  </View>
);

const ToggleRow = ({ label, checked, onToggle, color = '#0a84ff' }: any) => (
  <TouchableOpacity 
    style={[styles.counterRow, styles.checkboxRow, checked ? { backgroundColor: color } : null]} 
    onPress={onToggle}
  >
    <Text style={[styles.counterLabel, checked ? styles.textActive : null]}>{label}</Text>
    <Text style={[styles.checkboxIcon, checked ? styles.textActive : null]}>
      {checked ? 'YES' : 'NO'}
    </Text>
  </TouchableOpacity>
);

const OptionButton = ({ label, selected, onPress }: any) => (
  <TouchableOpacity 
    style={[styles.optionBtn, selected ? styles.optionBtnActive : null]} 
    onPress={onPress}
  >
    <Text style={[styles.optionBtnText, selected ? styles.textActive : null]}>{label}</Text>
  </TouchableOpacity>
);

// Screens
const LoginView = ({ username, setUsername, handleLogin, isLoading }: any) => (
  <View style={styles.centerContainer}>
    <View style={styles.card}>
      <Text style={styles.title}>FRC 2026</Text>
      <Text style={styles.subtitle}>Scouting Login</Text>
      
      <Text style={styles.label}>Username</Text>
      <TextInput 
        style={styles.input} 
        placeholder="testuser" 
        placeholderTextColor="#888"
        value={username} 
        onChangeText={setUsername} 
        autoCapitalize="none"
      />
      
      <TouchableOpacity style={styles.submitBtn} onPress={handleLogin} disabled={isLoading}>
        {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Start Shift</Text>}
      </TouchableOpacity>
      
      <Text style={styles.tinyText}>Requires internet for first login only.</Text>
    </View>
  </View>
);

const DashboardView = ({ 
  username, 
  matchesScouted, 
  station, 
  setStation, 
  matchQueue, 
  setShowQR, 
  onStart,
  setCurrentView 
}: any) => {
  // Turn the progress bar red if they are working past their shift limit
  const progress = Math.min((matchesScouted / SHIFT_LENGTH) * 100, 100);
  const barColor = progress >= 100 ? '#ff3b30' : '#4cd964';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Dashboard</Text>
        <Text style={styles.subtitle}>Scouter: {username}</Text>
      </View>

      <View style={styles.cardSection}>
        <Text style={styles.sectionHeader}>Shift Progress</Text>
        <View style={styles.progressBarBg}>
          <View style={[styles.progressBarFill, { width: `${progress}%`, backgroundColor: barColor }]} />
        </View>
        <Text style={styles.progressText}>{matchesScouted} / {SHIFT_LENGTH} Matches Scouted</Text>
        {progress >= 100 && <Text style={styles.alertText}>SHIFT COMPLETE! PLEASE SWAP OUT.</Text>}
      </View>

      <View style={styles.cardSection}>
        <Text style={styles.sectionHeader}>Select Your Seat</Text>
        <View style={styles.stationGrid}>
          {STATIONS.map((s) => (
            <TouchableOpacity 
              key={s} 
              style={[
                styles.stationBtn, 
                station === s ? styles.stationBtnActive : null, 
                s.includes('Red') ? styles.borderRed : styles.borderBlue
              ]}
              onPress={() => setStation(s)}
            >
              <Text style={styles.stationText}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Show an alert border if they have unsynced matches waiting to be scanned */}
      <View style={[styles.cardSection, matchQueue.length > 0 ? { borderColor: '#ffcc00', borderWidth: 1 } : {}]}>
        <Text style={[styles.placeholderText, { fontWeight: 'bold', color: matchQueue.length > 0 ? '#ffcc00' : '#888' }]}>
          Matches waiting to scan: {matchQueue.length}
        </Text>
        {matchQueue.length > 0 && (
          <TouchableOpacity style={styles.miniBtn} onPress={() => setShowQR(true)}>
            <Text style={styles.miniBtnText}>Show Batch QR Code</Text>
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity style={[styles.submitBtn, { marginTop: 20 }]} onPress={onStart}>
        <Text style={styles.submitText}>Scout Next Match</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.submitBtn, { marginTop: 10, backgroundColor: '#8a2be2' }]} onPress={() => setCurrentView('pit')}>
        <Text style={styles.submitText}>Pit Scouting Mode</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const ScoutingFormView = ({ form, setForm, station, onSave, onCancel }: any) => {
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container}>
        
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={onCancel}><Text style={styles.backLink}>← Cancel</Text></TouchableOpacity>
          <Text style={styles.headerTitle}>{station}</Text>
          <View style={{ width: 40 }} /> 
        </View>

        {/* --- Match Setup --- */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Match Info</Text>
          <View style={styles.inputRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Match #</Text>
              <TextInput 
                style={styles.input} 
                keyboardType="numeric" 
                value={form.matchNumber} 
                onChangeText={(t) => setForm((p: any) => ({ ...p, matchNumber: t }))} 
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Team #</Text>
              <TextInput 
                style={[styles.input, { borderColor: '#0a84ff', borderWidth: 2 }]} 
                keyboardType="numeric" 
                value={form.teamNumber} 
                onChangeText={(t) => setForm((p: any) => ({ ...p, teamNumber: t }))} 
              />
            </View>
          </View>
        </View>

        {/* --- Autonomous Phase --- */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Autonomous</Text>
          
          <Text style={styles.label}>Starting Position</Text>
          <View style={styles.optionRow}>
            {AUTO_POSITIONS.map(opt => (
              <OptionButton key={opt} label={opt} selected={form.startPos === opt} onPress={() => setForm((p: any) => ({ ...p, startPos: opt }))} />
            ))}
          </View>

          <View style={styles.divider} />

          {/* User specifically requested counters go up by 5 here */}
          <CounterRow label="Makes (Fuel)" value={form.autoMake} step={5} onChange={(v: number) => setForm((p: any) => ({ ...p, autoMake: Math.max(0, p.autoMake + v) }))} />
          <CounterRow label="Miss (Fuel)" value={form.autoMiss} onChange={(v: number) => setForm((p: any) => ({ ...p, autoMiss: Math.max(0, p.autoMiss + v) }))} />
          
          <Text style={styles.label}>Pass Volume</Text>
          <View style={styles.optionRow}>
            {PASS_VOLUMES.map(opt => (
              <OptionButton key={opt} label={opt} selected={form.autoPassVol === opt} onPress={() => setForm((p: any) => ({ ...p, autoPassVol: opt }))} />
            ))}
          </View>

          <View style={styles.divider} />
          
          <Text style={styles.label}>Collect From:</Text>
          <View style={styles.optionRow}>
            <OptionButton label="Outpost" selected={form.autoCollect.outpost} onPress={() => setForm((p: any) => ({ ...p, autoCollect: { ...p.autoCollect, outpost: !p.autoCollect.outpost } }))} />
            <OptionButton label="Depot" selected={form.autoCollect.depot} onPress={() => setForm((p: any) => ({ ...p, autoCollect: { ...p.autoCollect, depot: !p.autoCollect.depot } }))} />
            <OptionButton label="Neutral" selected={form.autoCollect.neutral} onPress={() => setForm((p: any) => ({ ...p, autoCollect: { ...p.autoCollect, neutral: !p.autoCollect.neutral } }))} />
          </View>

          <View style={styles.divider} />

          <Text style={styles.label}>Auto Climb (30pts)</Text>
          <View style={styles.optionRow}>
            <OptionButton label="No" selected={form.autoClimb === 'None'} onPress={() => setForm((p: any) => ({ ...p, autoClimb: 'None' }))} />
            <OptionButton label="YES" selected={form.autoClimb === 'Yes'} onPress={() => setForm((p: any) => ({ ...p, autoClimb: 'Yes' }))} />
            <OptionButton label="Fail" selected={form.autoClimb === 'Fail'} onPress={() => setForm((p: any) => ({ ...p, autoClimb: 'Fail' }))} />
          </View>
        </View>

        {/* --- Teleop Phase --- */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Teleop</Text>
          
          <Text style={styles.label}>Who won Auto?</Text>
          <View style={styles.optionRow}>
            {AUTO_WINNERS.map(opt => (
              <OptionButton key={opt} label={opt} selected={form.autoWinner === opt} onPress={() => setForm((p: any) => ({ ...p, autoWinner: opt }))} />
            ))}
          </View>

          <View style={styles.divider} />

          <CounterRow label="Hits (Fuel)" value={form.teleMake} step={5} onChange={(v: number) => setForm((p: any) => ({ ...p, teleMake: Math.max(0, p.teleMake + v) }))} />
          <CounterRow label="Misses" value={form.teleMiss} onChange={(v: number) => setForm((p: any) => ({ ...p, teleMiss: Math.max(0, p.teleMiss + v) }))} />
          <CounterRow label="Ferry Volume" value={form.teleFerry} step={5} onChange={(v: number) => setForm((p: any) => ({ ...p, teleFerry: Math.max(0, p.teleFerry + v) }))} />

          <View style={styles.divider} />

          <Text style={styles.label}>Crossing Counts</Text>
          <CounterRow label="Bump" value={form.bumpCross} onChange={(v: number) => setForm((p: any) => ({ ...p, bumpCross: Math.max(0, p.bumpCross + v) }))} />
          <CounterRow label="Trench" value={form.trenchCross} onChange={(v: number) => setForm((p: any) => ({ ...p, trenchCross: Math.max(0, p.trenchCross + v) }))} />

          <View style={styles.divider} />

          <Text style={styles.label}>Defense Effectiveness</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Needs improvement"
            placeholderTextColor="#666"
            value={form.defenseRating}
            onChangeText={(t) => setForm((p: any) => ({ ...p, defenseRating: t }))}
          />

          <Text style={styles.label}>Defense Strategy</Text>
          <View style={styles.optionRow}>
            {DEFENSE_STRATEGIES.map(opt => (
              <OptionButton key={opt} label={opt} selected={form.defenseStrategy === opt} onPress={() => setForm((p: any) => ({ ...p, defenseStrategy: opt }))} />
            ))}
          </View>

          <View style={styles.divider} />

          <ToggleRow label="ROBOT DIED / AFK" checked={form.incapacitated} color="#ff3b30" onToggle={() => setForm((p: any) => ({ ...p, incapacitated: !p.incapacitated }))} />
        </View>

        {/* --- Endgame Phase --- */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Endgame</Text>
          <View style={styles.climbContainer}>
            {ENDGAME_ACTIONS.map((level) => (
              <TouchableOpacity key={level} style={[styles.climbBtn, form.endgameAction === level ? styles.climbBtnActive : null]} onPress={() => setForm((p: any) => ({ ...p, endgameAction: level }))}>
                <Text style={[styles.climbBtnText, form.endgameAction === level ? styles.textActive : null]}>{level}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.label}>Time Estimate (Seconds)</Text>
          <TextInput 
            style={styles.input} 
            placeholder="e.g. 15" 
            placeholderTextColor="#666" 
            keyboardType="numeric" 
            value={form.climbTime} 
            onChangeText={(t) => setForm((p: any) => ({ ...p, climbTime: t }))} 
          />
        </View>

        {/* --- Post Match Notes --- */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Post Match</Text>
          <CounterRow label="Fouls" value={form.fouls} onChange={(v: number) => setForm((p: any) => ({ ...p, fouls: Math.max(0, p.fouls + v) }))} />
          <Text style={styles.label}>Qualitative Notes</Text>
          <TextInput
            style={styles.notesInput}
            multiline
            placeholder="Issues, Strategy, etc..."
            placeholderTextColor="#888"
            value={form.notes}
            onChangeText={(t) => setForm((p: any) => ({ ...p, notes: t }))}
          />
        </View>

        <TouchableOpacity style={styles.submitBtn} onPress={onSave}>
          <Text style={styles.submitText}>Save Match Data</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

// Main App Container
export default function App() {
  // Top level navigation state
  const [currentView, setCurrentView] = useState<ViewState>('login');
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // User shift preferences
  const [station, setStation] = useState<Station>('Red1');
  const [matchesScouted, setMatchesScouted] = useState(0);

  // Local storage queue for offline capability
  const [matchQueue, setMatchQueue] = useState<HistoryItem[]>([]);
  const [showQR, setShowQR] = useState(false);

  const [form, setForm] = useState<MatchData>(INITIAL_MATCH_DATA);

  // Check if they left the app and came back, so they don't have to login again
  useEffect(() => {
    AsyncStorage.getItem('@scout_username').then(u => {
      if (u) {
        setUsername(u);
        setCurrentView('dashboard');
      }
    });
    AsyncStorage.getItem('@match_queue').then(q => {
      if (q) setMatchQueue(JSON.parse(q));
    });
  }, []);

  // When the match number or station changes, try to automatically figure out the team number for them
  useEffect(() => {
    if (form.matchType === 'Qual' && MOCK_SCHEDULE[form.matchNumber]) {
      const assigned = MOCK_SCHEDULE[form.matchNumber][station];
      if (assigned) setForm(p => ({ ...p, teamNumber: assigned, station }));
    }
  }, [form.matchNumber, station, form.matchType]);

  const handleLogin = async () => {
    setIsLoading(true);
    try {
      // Connect to the backend to verify the scouter
      const res = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: '4FeetTallRisith?45!' })
      });
      const data = await res.json();
      
      if (res.status === 201) {
        setToken(data.accessToken);
        await AsyncStorage.setItem('@scout_username', username);
        setCurrentView('dashboard');
      } else {
        Alert.alert("Error", "Login failed (Use 'testuser')");
      }
    } catch (e) {
      Alert.alert("Network Error", "Could not reach backend");
    }
    setIsLoading(false);
  };

  const handleSaveMatch = async () => {
    if (!form.teamNumber || !form.matchNumber) {
      Alert.alert("Missing Info", "Check Team/Match Number");
      return;
    }

    // Because the old backend doesn't support our shiny new UI fields,
    // we bundle the new metrics into the generic notes string so we don't lose the data.
    const extraData = `
      [Start:${form.startPos}] [Pass:${form.autoPassVol}] [Collect:${JSON.stringify(form.autoCollect)}]
      [AutoWin:${form.autoWinner}] [Ferry:${form.teleFerry}] 
      [Bump:${form.bumpCross}] [Trench:${form.trenchCross}]
      [Def:${form.defenseRating}-${form.defenseStrategy}] 
      [Dead:${form.incapacitated}] [Time:${form.climbTime}]
    `.replace(/\s+/g, ' ').trim();

    // Make sure we strip any accidental pipe characters since we use those to split the QR code later
    const fullNotes = `${extraData} | ${form.notes.replace(/\|/g, '')}`;

    // Assemble the QR string EXACTLY matching the indices expected by scanner.html
    const dataString = [
      form.eventCode,                                            // 0
      form.matchNumber,                                          // 1
      form.teamNumber,                                           // 2
      username,                                                  // 3
      form.startPos,                                             // 4
      form.autoMake,                                             // 5
      form.autoMiss,                                             // 6
      form.autoClimb,                                            // 7
      form.autoPassVol,                                          // 8  (New)
      form.autoWinner,                                           // 9  (New)
      form.teleMake,                                             // 10
      form.teleFerry,                                            // 11 (New)
      form.bumpCross,                                            // 12 (New)
      form.trenchCross,                                          // 13 (New)
      (form.defenseRating || "").toString().replace(/\|/g, ''),  // 14 (New)
      form.defenseStrategy,                                      // 15 (New)
      form.endgameAction,                                        // 16
      form.climbTime || "0",                                     // 17 (New)
      form.incapacitated ? 'DIE' : 'OK',                         // 18 (New)
      fullNotes                                                  // 19 (Notes)
    ].join('|');

    const newRecord: HistoryItem = {
      id: Date.now().toString(),
      matchNum: form.matchNumber,
      teamNum: form.teamNumber,
      qrString: dataString
    };

    // Save to device storage
    const newQueue = [...matchQueue, newRecord];
    setMatchQueue(newQueue);
    await AsyncStorage.setItem('@match_queue', JSON.stringify(newQueue));

    setMatchesScouted(prev => prev + 1);
    
    // Automatically increment the match number for the next round
    const nextMatch = (parseInt(form.matchNumber, 10) + 1).toString();
    
    // Wipe out the old data, but keep the meta data (like the new match number)
    setForm({
      ...INITIAL_MATCH_DATA,
      matchNumber: nextMatch
    });

    setCurrentView('dashboard');
  };

  const clearQueue = async () => {
    setMatchQueue([]);
    await AsyncStorage.setItem('@match_queue', '[]');
    setShowQR(false);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      
      {/* Batch QR Code Scanner Modal */}
      <Modal visible={showQR} animationType="slide" transparent={true}>
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Batch QR Code</Text>
            <Text style={styles.modalSubtitle}>{matchQueue.length} Matches Saved</Text>
            
            <View style={styles.qrContainer}>
              {matchQueue.length > 0 && (
                <QRCode 
                  value={matchQueue.map(m => m.qrString).join('#')} 
                  size={Dimensions.get('window').width - 80} 
                  backgroundColor='white' 
                  color='black' 
                  ecl='L' 
                />
              )}
            </View>
            
            <TouchableOpacity style={[styles.closeBtn, { backgroundColor: '#2b5c35' }]} onPress={clearQueue}>
              <Text style={styles.closeBtnText}>✓ Clear Queue (Scanned)</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={[styles.closeBtn, { backgroundColor: '#444', marginTop: 10 }]} onPress={() => setShowQR(false)}>
              <Text style={styles.closeBtnText}>✕ Close (Scan Later)</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* View Routing */}
      {currentView === 'login' && (
        <LoginView 
          username={username} 
          setUsername={setUsername} 
          handleLogin={handleLogin} 
          isLoading={isLoading} 
        />
      )}
      
      {currentView === 'dashboard' && (
        <DashboardView 
          username={username} 
          matchesScouted={matchesScouted} 
          station={station} 
          setStation={setStation} 
          matchQueue={matchQueue} 
          setShowQR={setShowQR} 
          onStart={() => setCurrentView('scouting')} 
          setCurrentView={setCurrentView} // Pass down setCurrentView so the dashboard can switch to pit scouting
        />
      )}
      
      {currentView === 'scouting' && (
        <ScoutingFormView 
          form={form} 
          setForm={setForm} 
          station={station} 
          onSave={handleSaveMatch} 
          onCancel={() => setCurrentView('dashboard')} 
        />
      )}
      
      {currentView === 'pit' && (
        <PitScoutingView 
          onBack={() => setCurrentView('dashboard')} 
          username={username}
          token={token} 
        />
      )}
    </SafeAreaView>
  );
}

// Global Stylesheet
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#121212'
  },
  container: {
    padding: 20,
    maxWidth: 600,
    width: '100%',
    alignSelf: 'center',
    paddingBottom: 50
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#1e1e1e',
    padding: 30,
    borderRadius: 15
  },
  section: {
    backgroundColor: '#1e1e1e',
    padding: 15,
    borderRadius: 12,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#333'
  },
  cardSection: {
    backgroundColor: '#1e1e1e',
    padding: 15,
    borderRadius: 12,
    marginBottom: 15
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 5
  },
  subtitle: {
    fontSize: 16,
    color: '#888',
    marginBottom: 25
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff'
  },
  sectionHeader: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    paddingBottom: 5
  },
  label: {
    color: '#bbb',
    fontSize: 14,
    marginBottom: 8,
    marginTop: 5
  },
  backLink: {
    color: '#0a84ff',
    fontSize: 16
  },
  progressText: {
    color: '#ccc',
    textAlign: 'center',
    fontSize: 12,
    marginTop: 5
  },
  alertText: {
    color: '#ff3b30',
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 5
  },
  placeholderText: {
    color: '#666',
    fontStyle: 'italic'
  },
  header: {
    marginBottom: 20,
    alignItems: 'center'
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20
  },
  inputRow: {
    flexDirection: 'row',
    gap: 10
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 15
  },
  divider: {
    height: 1,
    backgroundColor: '#333',
    marginVertical: 15
  },
  input: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#2c2c2c',
    color: '#fff',
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#444'
  },
  notesInput: {
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 8,
    padding: 10,
    height: 80,
    textAlignVertical: 'top',
    backgroundColor: '#2c2c2c',
    color: '#fff'
  },
  counterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15
  },
  counterLabel: {
    fontSize: 16,
    color: '#ddd',
    flex: 1
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  countValue: {
    fontSize: 18,
    fontWeight: 'bold',
    width: 30,
    textAlign: 'center',
    color: '#fff'
  },
  btn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20
  },
  btnMinus: {
    backgroundColor: '#3a2a2a',
    borderWidth: 1,
    borderColor: '#ff3b30'
  },
  btnPlus: {
    backgroundColor: '#2a3a2a',
    borderWidth: 1,
    borderColor: '#4cd964'
  },
  btnText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff'
  },
  submitBtn: {
    backgroundColor: '#0a84ff',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    width: '100%'
  },
  submitText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold'
  },
  optionBtn: {
    backgroundColor: '#2c2c2c',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#444'
  },
  optionBtnActive: {
    backgroundColor: '#0a84ff',
    borderColor: '#0a84ff'
  },
  optionBtnText: {
    color: '#ccc',
    fontSize: 14,
    fontWeight: '600'
  },
  textActive: {
    color: '#fff'
  },
  climbContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10
  },
  climbBtn: {
    flex: 1,
    minWidth: '40%',
    backgroundColor: '#2c2c2c',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#444'
  },
  climbBtnActive: {
    backgroundColor: '#0a84ff',
    borderColor: '#0a84ff'
  },
  climbBtnText: {
    color: '#ccc',
    fontWeight: '600'
  },
  stationGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center'
  },
  stationBtn: {
    width: '30%',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    borderColor: '#444'
  },
  stationBtnActive: {
    backgroundColor: '#333'
  },
  borderRed: {
    borderColor: '#ff3b30'
  },
  borderBlue: {
    borderColor: '#0a84ff'
  },
  stationText: {
    color: '#fff',
    fontWeight: 'bold'
  },
  checkboxRow: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#252525',
    borderWidth: 1,
    borderColor: '#333'
  },
  checkboxIcon: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#fff'
  },
  progressBarBg: {
    height: 10,
    backgroundColor: '#333',
    borderRadius: 5,
    overflow: 'hidden',
    marginVertical: 10
  },
  progressBarFill: {
    height: '100%'
  },
  miniBtn: {
    marginTop: 10,
    padding: 8,
    backgroundColor: '#333',
    borderRadius: 6,
    alignItems: 'center'
  },
  miniBtnText: {
    color: '#aaa',
    fontSize: 12
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.95)'
  },
  modalContent: {
    width: '90%',
    backgroundColor: '#1e1e1e',
    borderRadius: 15,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#444'
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 5
  },
  modalSubtitle: {
    fontSize: 16,
    color: '#ffcc00',
    marginBottom: 20
  },
  qrContainer: {
    padding: 10,
    backgroundColor: 'white',
    borderRadius: 10,
    marginBottom: 20
  },
  closeBtn: {
    padding: 15,
    borderRadius: 10,
    width: '100%',
    alignItems: 'center'
  },
  closeBtnText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold'
  },
  tinyText: {
    color: '#666',
    fontSize: 12,
    marginTop: 15,
    fontStyle: 'italic'
  }
});