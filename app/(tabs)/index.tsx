import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Dimensions,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';

// ============================================================================
// CONFIGURATION & MOCK DATA
// ============================================================================

// If running on a physical phone, replace 'localhost' with your computer's IP (e.g., 192.168.1.5)
const API_URL = 'http://localhost:8000'; 

// How many matches until the app tells the scouter to take a break?
const SHIFT_LENGTH = 12; 

// Mock Schedule: In the real world, this is downloaded from The Blue Alliance API.
// This allows the app to auto-fill the Team Number based on the Match Number.
const MOCK_SCHEDULE: any = {
  "1": { "Red1": "254", "Red2": "1678", "Red3": "1323", "Blue1": "118", "Blue2": "148", "Blue3": "3310" },
  "2": { "Red1": "971", "Red2": "973", "Red3": "1690", "Blue1": "2056", "Blue2": "1114", "Blue3": "1241" },
  "3": { "Red1": "4414", "Red2": "2910", "Red3": "5985", "Blue1": "987", "Blue2": "359", "Blue3": "25" },
  // ... add more matches as needed
};


// ============================================================================
// TYPES & INTERFACES
// ============================================================================

type ViewState = 'login' | 'dashboard' | 'scouting' | 'history';
type Station = 'Red1' | 'Red2' | 'Red3' | 'Blue1' | 'Blue2' | 'Blue3';
type StartPos = 'Left' | 'Center' | 'Right';

// This holds ALL the data for a single match report
interface MatchData {
  // Meta
  id: string;
  scouter: string;
  eventCode: string;
  matchType: 'Qual' | 'Prac' | 'Play';
  matchNumber: string;
  teamNumber: string;
  station: Station;

  // Auto Phase
  startPos: StartPos;
  autoMake: number;
  autoMiss: number;
  autoPass: number; // Volume of balls passed
  autoClimb: 'None' | 'Park' | 'Fail';
  autoCollect: { outpost: boolean; depot: boolean; neutral: boolean };

  // Teleop Phase
  teleMake: number;
  teleMiss: number;
  teleFerry: number; // Volume of balls ferried
  bumpCross: number;
  trenchCross: number;
  defenseRating: number; // 0 (None) to 5 (Godly)
  incapacitated: boolean; // Did the robot die?

  // Endgame
  endgameAction: 'None' | 'Level 2' | 'Level 3' | 'Failed';
  
  // Post Match
  fouls: number;
  notes: string;
}

// Minimal structure for the QR History list
interface HistoryItem {
  id: string;
  matchNum: string;
  teamNum: string;
  qrString: string;
}


// ============================================================================
// HELPER COMPONENTS (BUTTONS & COUNTERS)
// ============================================================================

// A standard + / - Counter Row
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

// A simple toggle button (like for Incapacitated)
const ToggleRow = ({ label, checked, onToggle, color = '#0a84ff' }: any) => (
  <TouchableOpacity 
    style={[styles.counterRow, styles.checkboxRow, checked ? {backgroundColor: color} : null]} 
    onPress={onToggle}
  >
    <Text style={[styles.counterLabel, checked ? styles.textActive : null]}>{label}</Text>
    <Text style={[styles.checkboxIcon, checked ? styles.textActive : null]}>
      {checked ? 'YES' : 'NO'}
    </Text>
  </TouchableOpacity>
);

// Used for things like "Start Position" or "Match Type"
const OptionButton = ({ label, selected, onPress }: any) => (
  <TouchableOpacity 
    style={[styles.optionBtn, selected ? styles.optionBtnActive : null]} 
    onPress={onPress}
  >
    <Text style={[styles.optionBtnText, selected ? styles.textActive : null]}>{label}</Text>
  </TouchableOpacity>
);


// ============================================================================
// MAIN APPLICATION
// ============================================================================

export default function App() {
  
  // --- Global App State ---
  const [currentView, setCurrentView] = useState<ViewState>('login');
  const [username, setUsername] = useState('');
  
  // Logistics State (Shift Tracking)
  const [station, setStation] = useState<Station>('Red1');
  const [matchesScouted, setMatchesScouted] = useState(0);
  
  // QR & Storage State
  const [matchQueue, setMatchQueue] = useState<HistoryItem[]>([]);
  const [showQR, setShowQR] = useState(false);

  // --- Scouting Form State ---
  // We initialize the form with default values
  const [form, setForm] = useState<MatchData>({
    id: '',
    scouter: '',
    eventCode: '2026A',
    matchType: 'Qual',
    matchNumber: '1',
    teamNumber: '',
    station: 'Red1',
    
    startPos: 'Center',
    autoMake: 0,
    autoMiss: 0,
    autoPass: 0,
    autoClimb: 'None',
    autoCollect: { outpost: false, depot: false, neutral: false },

    teleMake: 0,
    teleMiss: 0,
    teleFerry: 0,
    bumpCross: 0,
    trenchCross: 0,
    defenseRating: 0,
    incapacitated: false,

    endgameAction: 'None',
    fouls: 0,
    notes: ''
  });

  // --- LIFECYCLE: LOAD USER ---
  useEffect(() => {
    // Check if we have a saved user from last time to skip login
    AsyncStorage.getItem('@scout_username').then(u => {
      if (u) {
        setUsername(u);
        setCurrentView('dashboard');
        // Load the queue from disk so we don't lose data on crash
        AsyncStorage.getItem('@match_queue').then(q => {
          if (q) setMatchQueue(JSON.parse(q));
        });
      }
    });
  }, []);

  // --- AUTO-ASSIGN LOGIC ---
  // When Match # or Station changes, we look at the Schedule to find the Team #
  useEffect(() => {
    if (form.matchType === 'Qual' && MOCK_SCHEDULE[form.matchNumber]) {
      const assignedTeam = MOCK_SCHEDULE[form.matchNumber][station];
      if (assignedTeam) {
        setForm(prev => ({ ...prev, teamNumber: assignedTeam, station: station }));
      }
    }
  }, [form.matchNumber, station, form.matchType]);


  // --- ACTIONS ---

  const handleLogin = (u: string) => {
    if (!u.trim()) return;
    setUsername(u);
    AsyncStorage.setItem('@scout_username', u);
    setCurrentView('dashboard');
  };

  const handleSaveMatch = async () => {
    // Basic Validation
    if (!form.teamNumber || !form.matchNumber) {
      Alert.alert("Wait!", "We need a Team Number and Match Number.");
      return;
    }

    // 1. Create the Compressed String for the QR Code
    // Order matters! The scanner must read these in the same order.
    // Format: Event|Match|Team|Scouter|Start|AutoFuel|AutoMiss|AutoClimb|TeleFuel|TeleFerry|Endgame|Notes...
    const dataString = [
      form.eventCode,
      form.matchNumber,
      form.teamNumber,
      username,
      form.startPos,
      form.autoMake,
      form.autoMiss,
      form.autoClimb,
      form.teleMake,
      form.teleFerry,
      form.endgameAction,
      form.defenseRating,
      form.incapacitated ? 'DIE' : 'OK',
      form.notes.replace(/\|/g, '') // Remove pipes from notes so it doesn't break format
    ].join('|');

    // 2. Save to History Queue
    const newRecord: HistoryItem = {
      id: Date.now().toString(),
      matchNum: form.matchNumber,
      teamNum: form.teamNumber,
      qrString: dataString
    };

    const updatedQueue = [...matchQueue, newRecord];
    setMatchQueue(updatedQueue);
    await AsyncStorage.setItem('@match_queue', JSON.stringify(updatedQueue));

    // 3. Increment Logistics
    setMatchesScouted(prev => prev + 1);
    
    // 4. Auto-Increment Match Number for the next round
    const nextMatch = (parseInt(form.matchNumber) + 1).toString();
    
    // 5. Reset Form (Keep Static Info, Clear Data)
    setForm(prev => ({
      ...prev,
      matchNumber: nextMatch,
      // Clear data fields
      autoMake: 0, autoMiss: 0, autoPass: 0, autoClimb: 'None',
      autoCollect: { outpost: false, depot: false, neutral: false },
      teleMake: 0, teleMiss: 0, teleFerry: 0, bumpCross: 0, trenchCross: 0,
      defenseRating: 0, incapacitated: false, endgameAction: 'None', fouls: 0, notes: ''
    }));

    // 6. Go to Dashboard (or show QR immediately if preferred)
    setCurrentView('dashboard');
  };

  // --- VIEWS ---

  const LoginView = () => (
    <View style={styles.centerContainer}>
      <View style={styles.card}>
        <Text style={styles.title}>FRC 2026 Scout</Text>
        <Text style={styles.subtitle}>Offline Mode</Text>
        <TextInput 
          style={styles.input} 
          placeholder="Enter Scouter Name" 
          placeholderTextColor="#888"
          value={username} 
          onChangeText={setUsername} 
        />
        <TouchableOpacity style={styles.submitBtn} onPress={() => handleLogin(username)}>
          <Text style={styles.submitText}>Start Shift</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const DashboardView = () => {
    // Calculate stamina bar color
    const progress = Math.min((matchesScouted / SHIFT_LENGTH) * 100, 100);
    const barColor = progress >= 100 ? '#ff3b30' : '#4cd964';

    return (
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Dashboard</Text>
          <Text style={styles.subtitle}>Scouter: {username}</Text>
        </View>

        {/* SHIFT PROGRESS BAR */}
        <View style={styles.cardSection}>
          <Text style={styles.sectionHeader}>Shift Stamina</Text>
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${progress}%`, backgroundColor: barColor }]} />
          </View>
          <Text style={styles.progressText}>{matchesScouted} / {SHIFT_LENGTH} Matches</Text>
          {progress >= 100 && <Text style={styles.alertText}>SHIFT COMPLETE! TAKE A BREAK.</Text>}
        </View>

        {/* STATION SELECTOR */}
        <View style={styles.cardSection}>
          <Text style={styles.sectionHeader}>Your Seat Assignment</Text>
          <View style={styles.stationGrid}>
            {['Red1', 'Red2', 'Red3', 'Blue1', 'Blue2', 'Blue3'].map((s) => (
              <TouchableOpacity 
                key={s} 
                style={[
                  styles.stationBtn, 
                  station === s ? styles.stationBtnActive : null, 
                  s.includes('Red') ? styles.borderRed : styles.borderBlue
                ]}
                onPress={() => setStation(s as Station)}
              >
                <Text style={styles.stationText}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* QR QUEUE STATUS */}
        <View style={[styles.cardSection, matchQueue.length > 0 ? {borderColor: '#ffcc00', borderWidth: 1} : {}]}>
          <Text style={[styles.placeholderText, {fontWeight: 'bold', color: matchQueue.length > 0 ? '#ffcc00' : '#888'}]}>
            Unscanned Matches: {matchQueue.length}
          </Text>
          {matchQueue.length > 0 && (
            <TouchableOpacity style={styles.miniBtn} onPress={() => setShowQR(true)}>
              <Text style={styles.miniBtnText}>Show Batch QR Code</Text>
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity style={[styles.submitBtn, {marginTop: 20}]} onPress={() => setCurrentView('scouting')}>
          <Text style={styles.submitText}>Scout Next Match</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  };

  const ScoutingFormView = () => (
    <ScrollView contentContainerStyle={styles.container}>
      {/* HEADER */}
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => setCurrentView('dashboard')}>
          <Text style={styles.backLink}>← Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{station}</Text>
        <View style={{width: 40}} /> 
      </View>

      {/* MATCH INFO (AUTO-FILLED) */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Match Info</Text>
        <View style={styles.inputRow}>
          <View style={{flex: 1}}>
            <Text style={styles.label}>Match Number</Text>
            <TextInput 
              style={styles.input} 
              keyboardType="numeric" 
              value={form.matchNumber} 
              onChangeText={(t) => setForm({...form, matchNumber: t})} 
            />
          </View>
          <View style={{flex: 1}}>
            <Text style={styles.label}>Team Number</Text>
            <TextInput 
              style={[styles.input, {borderColor: '#0a84ff', borderWidth: 2}]} 
              keyboardType="numeric" 
              value={form.teamNumber} 
              // We make this editable just in case the schedule is wrong
              onChangeText={(t) => setForm({...form, teamNumber: t})} 
            />
          </View>
        </View>
      </View>

      {/* AUTO PHASE */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Autonomous</Text>
        
        <Text style={styles.label}>Starting Position</Text>
        <View style={styles.optionRow}>
          {['Left', 'Center', 'Right'].map(opt => (
            <OptionButton 
              key={opt} label={opt} 
              selected={form.startPos === opt} 
              onPress={() => setForm({...form, startPos: opt as StartPos})} 
            />
          ))}
        </View>

        <View style={styles.divider} />

        <CounterRow label="Fuel Scored" value={form.autoMake} onChange={(v: number) => setForm(p => ({...p, autoMake: Math.max(0, p.autoMake + v)}))} step={5} />
        <CounterRow label="Fuel Missed" value={form.autoMiss} onChange={(v: number) => setForm(p => ({...p, autoMiss: Math.max(0, p.autoMiss + v)}))} />
        <CounterRow label="Passed Volume" value={form.autoPass} onChange={(v: number) => setForm(p => ({...p, autoPass: Math.max(0, p.autoPass + v)}))} />

        <View style={styles.divider} />
        
        <Text style={styles.label}>Collected From:</Text>
        <View style={styles.optionRow}>
          <OptionButton label="Outpost" selected={form.autoCollect.outpost} onPress={() => setForm(p => ({...p, autoCollect: {...p.autoCollect, outpost: !p.autoCollect.outpost}}))} />
          <OptionButton label="Depot" selected={form.autoCollect.depot} onPress={() => setForm(p => ({...p, autoCollect: {...p.autoCollect, depot: !p.autoCollect.depot}}))} />
          <OptionButton label="Neutral" selected={form.autoCollect.neutral} onPress={() => setForm(p => ({...p, autoCollect: {...p.autoCollect, neutral: !p.autoCollect.neutral}}))} />
        </View>

        <View style={styles.divider} />

        <Text style={styles.label}>Auto Climb Result</Text>
        <View style={styles.optionRow}>
          <OptionButton label="None" selected={form.autoClimb === 'None'} onPress={() => setForm({...form, autoClimb: 'None'})} />
          <OptionButton label="Park/Climb" selected={form.autoClimb === 'Park'} onPress={() => setForm({...form, autoClimb: 'Park'})} />
          <OptionButton label="Failed" selected={form.autoClimb === 'Fail'} onPress={() => setForm({...form, autoClimb: 'Fail'})} />
        </View>
      </View>

      {/*TELEOP PHASE */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Teleop</Text>
        
        <CounterRow label="Fuel Scored" value={form.teleMake} onChange={(v: number) => setForm(p => ({...p, teleMake: Math.max(0, p.teleMake + v)}))} step={5} />
        <CounterRow label="Fuel Missed" value={form.teleMiss} onChange={(v: number) => setForm(p => ({...p, teleMiss: Math.max(0, p.teleMiss + v)}))} />
        <CounterRow label="Ferry Volume" value={form.teleFerry} onChange={(v: number) => setForm(p => ({...p, teleFerry: Math.max(0, p.teleFerry + v)}))} />

        <View style={styles.divider} />

        <Text style={styles.label}>Field Crossings</Text>
        <CounterRow label="Bump" value={form.bumpCross} onChange={(v: number) => setForm(p => ({...p, bumpCross: Math.max(0, p.bumpCross + v)}))} />
        <CounterRow label="Trench" value={form.trenchCross} onChange={(v: number) => setForm(p => ({...p, trenchCross: Math.max(0, p.trenchCross + v)}))} />

        <View style={styles.divider} />

        <Text style={styles.label}>Defense Effectiveness (0-5)</Text>
        <View style={styles.optionRow}>
          {[0, 1, 2, 3, 4, 5].map(rating => (
            <TouchableOpacity 
              key={rating} 
              style={[styles.ratingBtn, form.defenseRating === rating ? {backgroundColor: '#0a84ff'} : {}]} 
              onPress={() => setForm({...form, defenseRating: rating})}
            >
              <Text style={{color: '#fff', fontWeight: 'bold'}}>{rating}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.divider} />

        <ToggleRow 
          label="ROBOT DIED / INCAPACITATED" 
          checked={form.incapacitated} 
          color="#ff3b30"
          onToggle={() => setForm(p => ({...p, incapacitated: !p.incapacitated}))} 
        />
      </View>

      {/* 🧗 ENDGAME */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Endgame</Text>
        <View style={styles.climbContainer}>
          {['None', 'Level 2', 'Level 3', 'Failed'].map((level) => (
            <TouchableOpacity 
              key={level} 
              style={[styles.climbBtn, form.endgameAction === level ? styles.climbBtnActive : null]} 
              onPress={() => setForm({...form, endgameAction: level as any})}
            >
              <Text style={[styles.climbBtnText, form.endgameAction === level ? styles.textActive : null]}>{level}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* 📝 NOTES & FOULS */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Post Match</Text>
        <CounterRow label="Fouls" value={form.fouls} onChange={(v: number) => setForm(p => ({...p, fouls: Math.max(0, p.fouls + v)}))} />
        
        <Text style={styles.label}>Qualitative Notes (Robot Problems, Strategy)</Text>
        <TextInput
          style={styles.notesInput}
          multiline
          placeholder="Broken intake? Good defense against 254?..."
          placeholderTextColor="#888"
          value={form.notes}
          onChangeText={(t) => setForm({...form, notes: t})}
        />
      </View>

      <TouchableOpacity style={styles.submitBtn} onPress={handleSaveMatch}>
        <Text style={styles.submitText}>Save Match Data</Text>
      </TouchableOpacity>
    </ScrollView>
  );

  // --- RENDER RETURN ---
  return (
    <SafeAreaView style={styles.safeArea}>
      {/* QR MODAL */}
      <Modal visible={showQR} animationType="slide" transparent={true}>
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Batch QR Code</Text>
            <Text style={styles.modalSubtitle}>Contains {matchQueue.length} Matches</Text>
            <View style={styles.qrContainer}>
              {matchQueue.length > 0 && (
                <QRCode 
                  value={matchQueue.map(m => m.qrString).join('#')} 
                  size={Dimensions.get('window').width - 80} 
                  backgroundColor='white' color='black' ecl='L' 
                />
              )}
            </View>
            <TouchableOpacity style={[styles.closeBtn, {backgroundColor: '#2b5c35'}]} onPress={() => { setMatchQueue([]); AsyncStorage.setItem('@match_queue', '[]'); setShowQR(false); }}>
              <Text style={styles.closeBtnText}>✓ Clear Queue (Scanned)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.closeBtn, {backgroundColor: '#444', marginTop: 10}]} onPress={() => setShowQR(false)}>
              <Text style={styles.closeBtnText}>✕ Close (Scan Later)</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {currentView === 'login' && <LoginView />}
      {currentView === 'dashboard' && <DashboardView />}
      {currentView === 'scouting' && <ScoutingFormView />}
    </SafeAreaView>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#121212' },
  container: { padding: 20, maxWidth: 600, width: '100%', alignSelf: 'center', paddingBottom: 50 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  
  // Cards
  card: { width: '100%', maxWidth: 400, backgroundColor: '#1e1e1e', padding: 30, borderRadius: 15 },
  section: { backgroundColor: '#1e1e1e', padding: 15, borderRadius: 12, marginBottom: 15, borderWidth: 1, borderColor: '#333' },
  cardSection: { backgroundColor: '#1e1e1e', padding: 15, borderRadius: 12, marginBottom: 15 },

  // Typography
  title: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 5 },
  subtitle: { fontSize: 16, color: '#888', marginBottom: 25 },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  sectionHeader: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 15, borderBottomWidth: 1, borderBottomColor: '#333', paddingBottom: 5 },
  label: { color: '#bbb', fontSize: 14, marginBottom: 8, marginTop: 5 },
  backLink: { color: '#0a84ff', fontSize: 16 },
  progressText: { color: '#ccc', textAlign: 'center', fontSize: 12, marginTop: 5 },
  alertText: { color: '#ff3b30', fontWeight: 'bold', textAlign: 'center', marginTop: 5 },
  placeholderText: { color: '#666', fontStyle: 'italic' },

  // Layouts
  header: { marginBottom: 20, alignItems: 'center' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  inputRow: { flexDirection: 'row', gap: 10 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 15 },
  divider: { height: 1, backgroundColor: '#333', marginVertical: 15 },

  // Inputs
  input: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#2c2c2c', color: '#fff', fontSize: 16, borderWidth: 1, borderColor: '#444' },
  notesInput: { borderWidth: 1, borderColor: '#444', borderRadius: 8, padding: 10, height: 80, textAlignVertical: 'top', backgroundColor: '#2c2c2c', color: '#fff' },

  // Counters
  counterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  counterLabel: { fontSize: 16, color: '#ddd', flex: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  countValue: { fontSize: 18, fontWeight: 'bold', width: 30, textAlign: 'center', color: '#fff' },

  // Buttons
  btn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center', borderRadius: 20 },
  btnMinus: { backgroundColor: '#3a2a2a', borderWidth: 1, borderColor: '#ff3b30' },
  btnPlus: { backgroundColor: '#2a3a2a', borderWidth: 1, borderColor: '#4cd964' },
  btnText: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  
  submitBtn: { backgroundColor: '#0a84ff', padding: 16, borderRadius: 12, alignItems: 'center', width: '100%' },
  submitText: { color: 'white', fontSize: 18, fontWeight: 'bold' },
  
  // Option Buttons
  optionBtn: { backgroundColor: '#2c2c2c', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: '#444' },
  optionBtnActive: { backgroundColor: '#0a84ff', borderColor: '#0a84ff' },
  optionBtnText: { color: '#ccc', fontSize: 14, fontWeight: '600' },
  textActive: { color: '#fff' },

  // Climb Buttons
  climbContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  climbBtn: { flex: 1, minWidth: '40%', backgroundColor: '#2c2c2c', padding: 15, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#444' },
  climbBtnActive: { backgroundColor: '#0a84ff', borderColor: '#0a84ff' },
  climbBtnText: { color: '#ccc', fontWeight: '600' },

  // Rating Buttons (0-5)
  ratingBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#2c2c2c', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#444' },

  // Station Grid
  stationGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  stationBtn: { width: '30%', padding: 10, borderRadius: 8, borderWidth: 1, alignItems: 'center', borderColor: '#444' },
  stationBtnActive: { backgroundColor: '#333' },
  borderRed: { borderColor: '#ff3b30' },
  borderBlue: { borderColor: '#0a84ff' },
  stationText: { color: '#fff', fontWeight: 'bold' },

  // Toggle Row
  checkboxRow: { padding: 12, borderRadius: 8, backgroundColor: '#252525', borderWidth: 1, borderColor: '#333' },
  checkboxIcon: { fontSize: 14, fontWeight: 'bold', color: '#fff' },

  // Progress Bar
  progressBarBg: { height: 10, backgroundColor: '#333', borderRadius: 5, overflow: 'hidden', marginVertical: 10 },
  progressBarFill: { height: '100%' },

  // Mini Buttons
  miniBtn: { marginTop: 10, padding: 8, backgroundColor: '#333', borderRadius: 6, alignItems: 'center' },
  miniBtnText: { color: '#aaa', fontSize: 12 },

  // Modal
  modalContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.95)' },
  modalContent: { width: '90%', backgroundColor: '#1e1e1e', borderRadius: 15, padding: 20, alignItems: 'center', borderWidth: 1, borderColor: '#444' },
  modalTitle: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 5 },
  modalSubtitle: { fontSize: 16, color: '#ffcc00', marginBottom: 20 },
  qrContainer: { padding: 10, backgroundColor: 'white', borderRadius: 10, marginBottom: 20 },
  closeBtn: { padding: 15, borderRadius: 10, width: '100%', alignItems: 'center' },
  closeBtnText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
});