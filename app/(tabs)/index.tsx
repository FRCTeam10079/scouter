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
// const API_URL = 'https://6k0bvq8z-8000.usw2.devtunnels.ms/' ;
// my computer ip address 192.168.1.55
const DEFAULT_API_URL = '192.168.1.55:8000'; // Default if nothing saved
// Does not work on school wifi as it blocks the connection
// go to wifi ip create a vs code port make it public copy forwared address

// How many matches a scouter should do before we remind them to take a break
const SHIFT_LENGTH = 12; 

// A default schedule (empty) to start with.
// We will load the real schedule from Settings -> Paste JSON
const DEFAULT_SCHEDULE: any = {};

// Static lists for our UI buttons so React doesn't recreate them on every single render
const STATIONS = ['Red1', 'Red2', 'Red3', 'Blue1', 'Blue2', 'Blue3'];
const AUTO_POSITIONS = ['Left', 'Center', 'Right'];
const PASS_VOLUMES = ['None', 'Low', 'Med', 'High'];
const AUTO_WINNERS = ['Red', 'Blue', 'Tie'];
const ENDGAME_ACTIONS = ['None', 'Level 1', 'Level 2', 'Level 3', 'Failed'];

// The baseline state for a new match. We keep this here so we can easily reset the form later.
const INITIAL_MATCH_DATA: MatchData = {
  id: '', scouter: '', eventCode: '2026A', matchType: 'Qual', matchNumber: '1', teamNumber: '',
  station: 'Red1', startPos: 'Center', autoMake: 0, autoMiss: 0, autoPassVol: 'None', 
  autoClimb: 'None', autoCollect: { outpost: false, depot: false, neutral: false },
  autoWinner: 'Unknown', teleMake: 0, teleMiss: 0, teleFerry: 0, bumpCross: false, 
  trenchCross: false, incapacitated: false,
  deadTime: '', endgameAction: 'None', climbTime: '', fouls: 0, notes: ''
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
  bumpCross: boolean;
  trenchCross: boolean;
  incapacitated: boolean;
  deadTime: string;
  endgameAction: 'None' | 'Level 1' | 'Level 2' | 'Level 3' | 'Failed';
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

// Fallback component for QR Code if the string is too massive
class QRCodeWrapper extends React.Component<any, { hasError: boolean }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(prevProps: any) {
    if (prevProps.value !== this.props.value) {
      if (this.state.hasError) this.setState({ hasError: false });
    }
  }

  render() {
    // A standard V40 QR Code can technically hold up to 4K alphanumeric characters,
    // but react-native-qrcode-svg will crash earlier depending on strictness.
    const isTooBig = this.props.value && this.props.value.length > 2000;
    const windowDim = Dimensions.get('window');
    
    // Fit within width, but don't grow taller than the screen minus the headers and buttons
    const qrSize = Math.min(windowDim.width - 80, windowDim.height - 300);

    if (this.state.hasError || isTooBig) {
      return (
        <ScrollView style={{ maxHeight: 300, width: windowDim.width - 80 }}>
          <Text style={{ color: '#ff3b30', fontWeight: 'bold', marginBottom: 10 }}>
            Error: Data is too large for a single QR code. Maximum capacity exceeded.
          </Text>
          <Text style={{ color: '#ccc', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }}>
            {this.props.value}
          </Text>
        </ScrollView>
      );
    }
    return (
      <QRCode 
        value={this.props.value} 
        size={qrSize > 100 ? qrSize : 200} 
        backgroundColor='white' 
        color='black' 
        ecl='L' 
      />
    );
  }
}

// Screens
const LoginView = ({ errorMessage, username, setUsername, handleLogin, handleSignUp, isLoading, password, setPassword, firstName, setFirstName, lastName, setLastName, isSignUpMode, setIsSignUpMode, teamPassword, setTeamPassword }: any) => (
  <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
      <View style={styles.card}>
        <Text style={styles.title}>FRC 2026</Text>
        <Text style={styles.subtitle}>{isSignUpMode ? 'Scouting Sign Up' : 'Scouting Login'}</Text>
        
        {errorMessage ? (
          <View style={{ backgroundColor: '#ff3b3033', padding: 10, borderRadius: 8, marginBottom: 15, borderWidth: 1, borderColor: '#ff3b30' }}>
            <Text style={{ color: '#ff3b30', textAlign: 'center', fontWeight: 'bold' }}>{errorMessage}</Text>
          </View>
        ) : null}

        <Text style={styles.label}>Username</Text>
        <TextInput 
          style={styles.input} 
          placeholder="testuser" 
          placeholderTextColor="#888"
          value={username} 
          onChangeText={setUsername} 
          autoCapitalize="none"
        />

        <Text style={styles.label}>Password</Text>
        <TextInput 
          style={styles.input} 
          placeholder="Password" 
          placeholderTextColor="#888"
          value={password} 
          onChangeText={setPassword} 
          secureTextEntry
        />

      {isSignUpMode && (
        <>
          <Text style={styles.label}>First Name</Text>
          <TextInput 
            style={styles.input} 
            placeholder="First Name" 
            placeholderTextColor="#888"
            value={firstName} 
            onChangeText={setFirstName} 
          />

          <Text style={styles.label}>Last Name</Text>
          <TextInput 
            style={styles.input} 
            placeholder="Last Name" 
            placeholderTextColor="#888"
            value={lastName} 
            onChangeText={setLastName} 
          />

          <Text style={styles.label}>Team Password</Text>
          <TextInput 
            style={styles.input} 
            placeholder="AlexaIsOurScoutingLead!" 
            placeholderTextColor="#888"
            value={teamPassword} 
            onChangeText={setTeamPassword} 
            secureTextEntry
          />
        </>
      )}
      
        <TouchableOpacity style={styles.submitBtn} onPress={isSignUpMode ? handleSignUp : handleLogin} disabled={isLoading}>
          {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>{isSignUpMode ? 'Sign Up' : 'Start Shift'}</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setIsSignUpMode(!isSignUpMode)} style={{ marginTop: 15, alignItems: 'center', padding: 10 }}>
          <Text style={{ color: '#0a84ff', fontWeight: 'bold' }}>
            {isSignUpMode ? 'Already have an account? Log In' : 'Need an account? Sign Up'}
          </Text>
        </TouchableOpacity>
        
        <Text style={styles.tinyText}>Requires internet for first login only.</Text>
      </View>
    </ScrollView>
  </KeyboardAvoidingView>
);

const DashboardView = ({ 
  username, 
  matchesScouted, 
  station, 
  setStation, 
  matchQueue, 
  setShowQR, 
  onStart,
  setCurrentView,
  handleLogout,
  setIsSettingsOpen,
  isSeatUnlocked,
  setIsSeatUnlocked,
  textCompression,
  setTextCompression
}: any) => {
  // Turn the progress bar red if they are working past their shift limit
  const progress = Math.min((matchesScouted / SHIFT_LENGTH) * 100, 100);
  const barColor = progress >= 100 ? '#ff3b30' : '#4cd964';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginBottom: 10 }}>
        <TouchableOpacity onPress={() => setIsSettingsOpen(true)} style={{ padding: 8, paddingHorizontal: 12, backgroundColor: '#333', borderRadius: 8 }}>
          <Text style={{ color: '#fff' }}>⚙️</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleLogout} style={{ padding: 8, paddingHorizontal: 12, backgroundColor: '#ff3b30', borderRadius: 8 }}>
          <Text style={{ color: '#fff', fontWeight: 'bold' }}>Logout</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.header, { marginTop: -15 }]}>
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
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={styles.sectionHeader}>Select Your Seat</Text>
          {!isSeatUnlocked && <Text style={{ color: '#ff3b30', fontSize: 12 }}>🔒 Locked</Text>}
        </View>
        <View style={styles.stationGrid}>
          {STATIONS.map((s) => (
            <TouchableOpacity 
              key={s} 
              style={[
                styles.stationBtn, 
                station === s ? styles.stationBtnActive : null, 
                s.includes('Red') ? styles.borderRed : styles.borderBlue,
                !isSeatUnlocked && station !== s ? { opacity: 0.5 } : null
              ]}
              onPress={() => {
                if (isSeatUnlocked) {
                  setStation(s);
                  setIsSeatUnlocked(false); // Lock it back up immediately after selection
                  Alert.alert("Seat Locked", `You are now assigned to ${s}. Seat selection is locked.`);
                } else {
                  Alert.alert("Locked", "Seat selection is locked. Ask a lead to unlock it in Settings.");
                }
              }}
              disabled={!isSeatUnlocked && station !== s}
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

          {/* Counters go up by 5 here */}
          <CounterRow label="Makes (Fuel) +5" value={form.autoMake} step={5} onChange={(v: number) => setForm((p: any) => ({ ...p, autoMake: Math.max(0, p.autoMake + v) }))} />
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

          <CounterRow label="Hits (Fuel) +5" value={form.teleMake} step={5} onChange={(v: number) => setForm((p: any) => ({ ...p, teleMake: Math.max(0, p.teleMake + v) }))} />
          <CounterRow label="Misses" value={form.teleMiss} onChange={(v: number) => setForm((p: any) => ({ ...p, teleMiss: Math.max(0, p.teleMiss + v) }))} />
          <CounterRow label="Ferry Volume" value={form.teleFerry} step={5} onChange={(v: number) => setForm((p: any) => ({ ...p, teleFerry: Math.max(0, p.teleFerry + v) }))} />

          <View style={styles.divider} />

          <Text style={styles.label}>Crossings</Text>
          <ToggleRow label="Bump" checked={form.bumpCross} onToggle={() => setForm((p: any) => ({ ...p, bumpCross: !p.bumpCross }))} />
          <ToggleRow label="Trench" checked={form.trenchCross} onToggle={() => setForm((p: any) => ({ ...p, trenchCross: !p.trenchCross }))} />

          <View style={styles.divider} />

          <ToggleRow label="ROBOT DIED / AFK" checked={form.incapacitated} color="#ff3b30" onToggle={() => setForm((p: any) => ({ ...p, incapacitated: !p.incapacitated }))} />
          
          {form.incapacitated && (
            <View style={{ marginTop: 10 }}>
              <Text style={styles.label}>Seconds Dead</Text>
              <TextInput 
                style={styles.input} 
                placeholder="e.g. 15" 
                placeholderTextColor="#666" 
                keyboardType="numeric" 
                value={form.deadTime} 
                onChangeText={(t) => setForm((p: any) => ({ ...p, deadTime: t }))} 
              />
            </View>
          )}
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
          <Text style={styles.tinyTextLight}>Keep it short (max 400 chars) for the QR code</Text>
          <TextInput
            style={styles.notesInput}
            multiline
            placeholder="Issues, Strategy, etc..."
            placeholderTextColor="#888"
            value={form.notes}
            onChangeText={(t) => setForm((p: any) => ({ ...p, notes: t }))}
            maxLength={400}
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
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [teamPassword, setTeamPassword] = useState('');
  const [isSignUpMode, setIsSignUpMode] = useState(false);
  const [token, setToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Settings / Master Seat Selection
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [seatKeyInput, setSeatKeyInput] = useState('');
  const [isSeatUnlocked, setIsSeatUnlocked] = useState(false);
  const [masterSeatKey, setMasterSeatKey] = useState('SC-TEAM-SEAT'); // default key format
  const [newMasterKeyInput, setNewMasterKeyInput] = useState('');
  const [textCompression, setTextCompression] = useState('Default');

  // User shift preferences
  const [station, setStation] = useState<Station | ''>('');
  const [matchesScouted, setMatchesScouted] = useState(0);

  // Local storage queue for offline capability
  const [matchQueue, setMatchQueue] = useState<HistoryItem[]>([]);
  const [showQR, setShowQR] = useState(false);

  // Match Schedule State
  const [schedule, setSchedule] = useState<any>(DEFAULT_SCHEDULE);
  const [scheduleInput, setScheduleInput] = useState('');

  // API Configuration
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [apiUrlInput, setApiUrlInput] = useState('');

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
    // NEW: Load the saved schedule
    AsyncStorage.getItem('@match_schedule').then(s => {
      if (s) {
        try {
          setSchedule(JSON.parse(s));
        } catch (e) {
          console.log("Failed to parse saved schedule");
        }
      }
    });
    AsyncStorage.getItem('@master_seat_key').then(k => {
      if (k) setMasterSeatKey(k);
    });
    AsyncStorage.getItem('@refresh_token').then(t => {
      if (t) setRefreshToken(t);
    });
    AsyncStorage.getItem('@text_compression').then(c => {
      if (c) setTextCompression(c);
    });
    AsyncStorage.getItem('@api_url').then(u => {
      if (u) {
        setApiUrl(u);
        setApiUrlInput(u); // Pre-fill input with loaded value
      } else {
        setApiUrlInput(DEFAULT_API_URL);
      }
    });
  }, []);

  // When the match number or station changes, try to automatically figure out the team number for them
  useEffect(() => {
    if (form.matchType === 'Qual' && schedule[form.matchNumber] && station) {
      const assigned = schedule[form.matchNumber][station];
      if (assigned) setForm(p => ({ ...p, teamNumber: assigned, station }));
    }
  }, [form.matchNumber, station, form.matchType, schedule]);

  const handleLogin = async () => {
    setErrorMessage('');
    if (!username || !password) {
      const msg = "Please enter username and password";
      setErrorMessage(msg);
      Alert.alert("Error", msg);
      return;
    }
    setIsLoading(true);
    try {
      // Connect to the backend to verify the scouter
      const res = await fetch(`${apiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password })
      });
      const data = await res.json();
      
      if (res.status === 201) {
        setToken(data.accessToken);
        setRefreshToken(data.refreshToken);
        await AsyncStorage.setItem('@scout_username', username);
        await AsyncStorage.setItem('@refresh_token', data.refreshToken);
        setCurrentView('dashboard');
      } else {
        const msg = data.code || "Login failed";
        setErrorMessage(msg);
        Alert.alert("Error", msg);
      }
    } catch (e: any) {
      const msg = "Could not reach backend";
      setErrorMessage(msg);
      Alert.alert("Network Error", msg);
    }
    setIsLoading(false);
  };

  const handleSignUp = async () => {
    setErrorMessage('');
    if (!username || !password || !firstName || !lastName || !teamPassword) {
      const msg = "Please fill out all fields";
      setErrorMessage(msg);
      Alert.alert("Error", msg);
      return;
    }
    
    setIsLoading(true);
    
    try {
      const res = await fetch(`${apiUrl}/auth/sign-up`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, firstName, lastName, teamPassword })
      });
      const data = await res.json();
      
      if (res.status === 201) {
        setToken(data.accessToken);
        setRefreshToken(data.refreshToken);
        await AsyncStorage.setItem('@scout_username', username);
        await AsyncStorage.setItem('@refresh_token', data.refreshToken);
        setCurrentView('dashboard');
      } else {
        const msg = data.code || "Sign up failed";
        setErrorMessage(msg);
        Alert.alert("Error", msg);
      }
    } catch (e: any) {
      const msg = e.message || "Could not reach backend";
      setErrorMessage(msg);
      Alert.alert("Network Error", msg);
    }
    setIsLoading(false);
  };

  const handleLogout = async () => {
    try {
      if (refreshToken) {
        await fetch(`${apiUrl}/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: refreshToken
        });
      }
    } catch (e) {}
    
    await AsyncStorage.removeItem('@scout_username');
    await AsyncStorage.removeItem('@refresh_token');
    setUsername('');
    setPassword('');
    setToken('');
    setRefreshToken('');
    setIsSeatUnlocked(false);
    setCurrentView('login');
  };

  const handleSaveMatch = async () => {
    if (!form.teamNumber || !form.matchNumber) {
      Alert.alert("Missing Info", "Check Team/Match Number");
      return;
    }

    // Because the old backend doesn't support our shiny new UI fields,
    // we bundle the new metrics into the generic notes string so we don't lose the data.
    let extraData = '';
    let parsedNotes = form.notes.replace(/\|/g, ''); // Make sure to strip any accidental pipe characters
    
    // If incapacitated but no time entered, assume full match (150s)
    const effectiveDeadTime = form.incapacitated ? (form.deadTime || "150") : "0";

    if (textCompression === 'Extreme') {
      extraData = `${form.startPos.substring(0,1)}${form.autoPassVol.substring(0,1)}${form.autoCollect.outpost?1:0}${form.autoCollect.depot?1:0}${form.autoCollect.neutral?1:0}${form.autoWinner.substring(0,1)}${form.teleFerry}${form.bumpCross?1:0}${form.trenchCross?1:0}${form.incapacitated?1:0}${effectiveDeadTime}${form.climbTime}`;
      parsedNotes = parsedNotes.replace(/\s+/g, ' '); // Shrink double spaces
    } else if (textCompression === 'High') {
      extraData = `S:${form.startPos.substring(0,1)} P:${form.autoPassVol.substring(0,1)} C:${form.autoCollect.outpost?1:0}${form.autoCollect.depot?1:0}${form.autoCollect.neutral?1:0} W:${form.autoWinner.substring(0,1)} F:${form.teleFerry} B:${form.bumpCross?1:0} T:${form.trenchCross?1:0} X:${form.incapacitated?1:0} dT:${effectiveDeadTime} t:${form.climbTime}`;
    } else {
      // Default
      extraData = `
        [Start:${form.startPos}] [Pass:${form.autoPassVol}] [Collect:${JSON.stringify(form.autoCollect)}]
        [AutoWin:${form.autoWinner}] [Ferry:${form.teleFerry}] 
        [Bump:${form.bumpCross}] [Trench:${form.trenchCross}]
        [Dead:${form.incapacitated}] [DeadTime:${effectiveDeadTime}] [Time:${form.climbTime}]
      `.replace(/\s+/g, ' ').trim();
    }

    const fullNotes = `${extraData} | ${parsedNotes}`;

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
      form.endgameAction,                                        // 14
      form.climbTime || "0",                                     // 15 (New)
      form.incapacitated ? 'DIE' : 'OK',                         // 16 (New)
      fullNotes                                                  // 17 (Notes)
    ].join('|');

    // Attempt to submit to backend real-time
    const reportPayload = {
      createdAt: new Date().toISOString(),
      eventCode: form.eventCode.substring(0, 5).padEnd(5, 'A'), // ensure 5 chars
      matchType: form.matchType === 'Play' ? 'PLAYOFF' : 'QUALIFICATION',
      matchNumber: parseInt(form.matchNumber || "1", 10),
      teamNumber: parseInt(form.teamNumber || "1", 10),
      notes: fullNotes.substring(0, 400),
      minorFouls: form.fouls,
      majorFouls: 0,
      secondsIncapacitated: parseInt(effectiveDeadTime, 10),
      overBump: form.bumpCross,
      underTrench: form.trenchCross,
      startingPosition: form.startPos.toUpperCase(),
      auto: {
        notes: '',
        hubScores: form.autoMake,
        hubMisses: form.autoMiss,
        climb: form.autoClimb === 'Yes' ? 'LEVEL1' : (form.autoClimb === 'Fail' ? 'FAILED' : 'NONE'),
        passes: form.autoPassVol === 'High' ? 3 : (form.autoPassVol === 'Med' ? 2 : (form.autoPassVol === 'Low' ? 1 : 0)),
        collectDepot: form.autoCollect.depot,
        collectNeutral: form.autoCollect.neutral,
        collectOutpost: form.autoCollect.outpost,
        disruptNz: false
      },
      teleop: {
        notes: '',
        hubScores: form.teleMake,
        hubMisses: form.teleMiss,
        level: 0,
        climbFailed: false,
        defended: false,
        passes: form.teleFerry
      },
      endgame: {
        notes: '',
        level: form.endgameAction === 'Level 3' ? 3 : (form.endgameAction === 'Level 2' ? 2 : (form.endgameAction === 'Level 1' ? 1 : 0)),
        climbFailed: form.endgameAction === 'Failed'
      }
    };

    try {
      if (token) {
        const res = await fetch(`${apiUrl}/report`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(reportPayload)
        });
        
        if (res.status !== 201) {
          console.warn("Failed to submit report to backend online");
        }
      }
    } catch (err) {
      console.warn("Could not reach backend, relying only on QR queue");
    }

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
      
      {/* Settings Modal */}
      <Modal visible={isSettingsOpen} animationType="slide" transparent={true}>
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Settings / Seat Admin</Text>
            
            <View style={{ marginBottom: 30, width: '100%' }}>
              <Text style={styles.label}>Unlock Seat Selection</Text>
              <Text style={{ color: '#888', fontSize: 12, marginBottom: 5 }}>Only leads should know this code.</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TextInput
                  style={[styles.input, { flex: 1, marginBottom: 0 }]}
                  placeholder="Master Key"
                  placeholderTextColor="#888"
                  secureTextEntry
                  autoCapitalize="none"
                  value={seatKeyInput}
                  onChangeText={setSeatKeyInput}
                />
                <TouchableOpacity 
                  style={{ backgroundColor: '#0a84ff', paddingHorizontal: 20, justifyContent: 'center', borderRadius: 8 }} 
                  onPress={() => {
                    if (seatKeyInput === masterSeatKey) {
                      setIsSeatUnlocked(true);
                      setSeatKeyInput('');
                      setIsSettingsOpen(false);
                      Alert.alert("Success", "Seat selection unlocked!");
                    } else {
                      Alert.alert("Error", "Incorrect key.");
                    }
                  }}
                >
                  <Text style={{ color: 'white', fontWeight: 'bold' }}>Unlock</Text>
                </TouchableOpacity>
              </View>
              {isSeatUnlocked && <Text style={{ color: '#4cd964', marginTop: 5 }}>✓ Currently Unlocked</Text>}
            </View>

            <View style={{ marginBottom: 30, width: '100%', borderTopWidth: 1, borderTopColor: '#333', paddingTop: 15 }}>
              <Text style={styles.label}>QR Code Text Compression</Text>
              <Text style={{ color: '#888', fontSize: 12, marginBottom: 10 }}>If the batch code is too big to scan, turn this up.</Text>
              <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'center' }}>
                {['Default', 'High', 'Extreme'].map(lvl => (
                  <TouchableOpacity 
                    key={lvl}
                    style={[styles.optionBtn, textCompression === lvl ? styles.optionBtnActive : null, { flex: 1, alignItems: 'center' }]}
                    onPress={() => {
                      setTextCompression(lvl);
                      AsyncStorage.setItem('@text_compression', lvl);
                    }}
                  >
                    <Text style={[styles.optionBtnText, textCompression === lvl ? styles.textActive : null, { fontSize: 12 }]}>{lvl}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            
            <View style={{ marginBottom: 30, width: '100%', borderTopWidth: 1, borderTopColor: '#333', paddingTop: 15 }}>
              <Text style={styles.label}>Backend API URL</Text>
              <Text style={{ color: '#888', fontSize: 12, marginBottom: 5 }}>e.g. http://192.168.1.55:8000</Text>
              <TextInput
                style={[styles.input, { marginBottom: 10 }]}
                placeholder='http://...'
                placeholderTextColor="#666"
                autoCapitalize='none'
                value={apiUrlInput}
                onChangeText={setApiUrlInput}
              />
              <TouchableOpacity
                style={{ backgroundColor: '#ff9500', padding: 10, borderRadius: 8, alignItems: 'center' }}
                onPress={async () => {
                  let cleaned = apiUrlInput.trim();
                  // Remove trailing slash if present
                  if (cleaned.endsWith('/')) cleaned = cleaned.slice(0, -1);
                  setApiUrl(cleaned);
                  setApiUrlInput(cleaned);
                  await AsyncStorage.setItem('@api_url', cleaned);
                  Alert.alert("Success", "API URL Updated!");
                }}
              >
                <Text style={{ color: 'white', fontWeight: 'bold' }}>Save API URL</Text>
              </TouchableOpacity>
            </View>

            <View style={{ marginBottom: 30, width: '100%', borderTopWidth: 1, borderTopColor: '#333', paddingTop: 15 }}>
              <Text style={styles.label}>Load Match Schedule</Text>
              <Text style={{ color: '#888', fontSize: 12, marginBottom: 5 }}>Paste JSON: {"{'1':{'Red1':'123'...}}"}</Text>
              <TextInput
                style={[styles.input, { height: 60, marginBottom: 10 }]}
                placeholder='Paste Schedule JSON here...'
                placeholderTextColor="#666"
                multiline
                numberOfLines={3}
                value={scheduleInput}
                onChangeText={setScheduleInput}
              />
              <TouchableOpacity
                style={{ backgroundColor: '#ff9500', padding: 10, borderRadius: 8, alignItems: 'center' }}
                onPress={async () => {
                  try {
                    const parsed = JSON.parse(scheduleInput);
                    setSchedule(parsed);
                    await AsyncStorage.setItem('@match_schedule', scheduleInput);
                    setScheduleInput('');
                    Alert.alert("Success", "Schedule Loaded!");
                  } catch (e) {
                    Alert.alert("Error", "Invalid JSON format.");
                  }
                }}
              >
                <Text style={{ color: 'white', fontWeight: 'bold' }}>Save Schedule</Text>
              </TouchableOpacity>
            </View>
            
            <TouchableOpacity style={[styles.closeBtn, { backgroundColor: '#444' }]} onPress={() => setIsSettingsOpen(false)}>
              <Text style={styles.closeBtnText}>Close Settings</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Batch QR Code Scanner Modal */}
      <Modal visible={showQR} animationType="slide" transparent={true}>
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Batch QR Code</Text>
            <Text style={styles.modalSubtitle}>{matchQueue.length} Matches Saved</Text>
            
            <View style={styles.qrContainer}>
              {matchQueue.length > 0 && (
                <QRCodeWrapper 
                  value={matchQueue.map(m => m.qrString).join('#')} 
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
          errorMessage={errorMessage}
          username={username} 
          setUsername={setUsername} 
          handleLogin={handleLogin} 
          handleSignUp={handleSignUp}
          isLoading={isLoading} 
          password={password}
          setPassword={setPassword}
          firstName={firstName}
          setFirstName={setFirstName}
          lastName={lastName}
          setLastName={setLastName}
          teamPassword={teamPassword}
          setTeamPassword={setTeamPassword}
          isSignUpMode={isSignUpMode}
          setIsSignUpMode={(mode: boolean) => {
            setIsSignUpMode(mode);
            setErrorMessage('');
          }}
        />
      )}
      
      {currentView === 'dashboard' && (
        <DashboardView 
          username={username} 
          matchesScouted={matchesScouted} 
          station={station || 'None'} 
          setStation={setStation} 
          matchQueue={matchQueue} 
          setShowQR={setShowQR} 
          onStart={() => {
            if (!station) {
              Alert.alert("Seat Required", "Please ask a lead to unlock and select a seat before scouting.");
              return;
            }
            setCurrentView('scouting');
          }} 
          setCurrentView={setCurrentView}
          handleLogout={handleLogout}
          setIsSettingsOpen={setIsSettingsOpen}
          isSeatUnlocked={isSeatUnlocked || !station}
          setIsSeatUnlocked={setIsSeatUnlocked}
          textCompression={textCompression}
          setTextCompression={setTextCompression}
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
          apiUrl={apiUrl}
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
    minWidth: 40,
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
  },
  tinyTextLight: {
    color: '#888',
    fontSize: 12,
    marginBottom: 5,
    fontStyle: 'italic'
  }
});