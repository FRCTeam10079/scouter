import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useState } from "react";
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
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import PitScoutingView from "./PitScoutingView";

// App setup and configuration
const DEFAULT_API_URL = "https://6k0bvq8z-8000.usw2.devtunnels.ms";

// How many matches a scouter should do before we remind them to take a break
const SHIFT_LENGTH = 12;

// A default schedule (empty) to start with.
const DEFAULT_SCHEDULE: any = {};

// Static lists for our UI buttons
const STATIONS = ["Red1", "Red2", "Red3", "Blue1", "Blue2", "Blue3"];
const AUTO_POSITIONS = ["Left", "Center", "Right"];
const PASS_VOLUMES = ["None", "Low", "Med", "High"];
const AUTO_WINNERS = ["Red", "Blue", "Tie"];
const ENDGAME_ACTIONS = ["None", "Level 1", "Level 2", "Level 3", "Failed"];

// Helper: fetch with a timeout
const fetchWithTimeout = (url: string, options: any = {}, timeoutMs = 8000) => {
  return Promise.race([
    fetch(url, options),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Request timed out after ${timeoutMs / 1000}s`)),
        timeoutMs,
      ),
    ),
  ]);
};

// Data models
type ViewState = "login" | "dashboard" | "scouting" | "pit";
type Station = "Red1" | "Red2" | "Red3" | "Blue1" | "Blue2" | "Blue3";

interface MatchData {
  matchNumber: string;
  teamNumber: string;
  scouter: string;
  eventCode: string;
  matchType: "Qual" | "Prac" | "Play";
  station: Station;
  startPos: "Left" | "Center" | "Right";
  autoMake: number;
  autoMiss: number;
  autoPassVol: "None" | "Low" | "Med" | "High";
  autoClimb: "None" | "Yes" | "Fail";
  autoCollect: { outpost: boolean; depot: boolean; neutral: boolean };
  autoNotes: string;
  autoWinner: "Red" | "Blue" | "Tie" | "Unknown";
  teleMake: number;
  teleMiss: number;
  teleFerry: number;
  bumpCross: boolean;
  trenchCross: boolean;
  defended: boolean;
  incapacitated: boolean;
  teleNotes: string;
  deadTime: string;
  endgameAction: "None" | "Level 1" | "Level 2" | "Level 3" | "Failed";
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

// The baseline state for a new match.
const INITIAL_MATCH_DATA: MatchData = {
  scouter: "",
  eventCode: "2026A",
  matchType: "Qual",
  matchNumber: "1",
  teamNumber: "",
  station: "Red1",
  startPos: "Center",
  autoMake: 0,
  autoMiss: 0,
  autoPassVol: "None",
  autoClimb: "None",
  autoCollect: { outpost: false, depot: false, neutral: false },
  autoNotes: "",
  autoWinner: "Unknown",
  teleMake: 0,
  teleMiss: 0,
  teleFerry: 0,
  bumpCross: false,
  trenchCross: false,
  defended: false,
  incapacitated: false,
  teleNotes: "",
  deadTime: "",
  endgameAction: "None",
  climbTime: "",
  fouls: 0,
  notes: "",
};

// Reusable mini-components to keep our main screen code clean
const CounterRow = ({ label, value, onChange, plusStep = 1, minusStep = 1 }: any) => (
  <View style={styles.counterRow}>
    <Text style={styles.counterLabel}>{label}</Text>
    <View style={styles.stepper}>
      <TouchableOpacity style={[styles.btn, styles.btnMinus]} onPress={() => onChange(-minusStep)}>
        <Text style={styles.btnText}>-</Text>
      </TouchableOpacity>
      <Text style={styles.countValue}>{value}</Text>
      <TouchableOpacity style={[styles.btn, styles.btnPlus]} onPress={() => onChange(plusStep)}>
        <Text style={styles.btnText}>+</Text>
      </TouchableOpacity>
    </View>
  </View>
);

const ToggleRow = ({ label, checked, onToggle, color = "#0a84ff" }: any) => (
  <TouchableOpacity
    style={[
      styles.counterRow,
      styles.checkboxRow,
      checked ? { backgroundColor: color } : null,
    ]}
    onPress={onToggle}
  >
    <Text style={[styles.counterLabel, checked ? styles.textActive : null]}>
      {label}
    </Text>
    <Text style={[styles.checkboxIcon, checked ? styles.textActive : null]}>
      {checked ? "YES" : "NO"}
    </Text>
  </TouchableOpacity>
);

const OptionButton = ({ label, selected, onPress }: any) => (
  <TouchableOpacity
    style={[styles.optionBtn, selected ? styles.optionBtnActive : null]}
    onPress={onPress}
  >
    <Text style={[styles.optionBtnText, selected ? styles.textActive : null]}>
      {label}
    </Text>
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
    const isTooBig = this.props.value && this.props.value.length > 2000;
    const windowDim = Dimensions.get("window");
    const qrSize =
      this.props.size || Math.min(windowDim.width - 80, windowDim.height - 300);

    if (this.state.hasError || isTooBig) {
      return (
        <ScrollView style={{ maxHeight: 300, width: windowDim.width - 80 }}>
          <Text
            style={{ color: "#ff3b30", fontWeight: "bold", marginBottom: 10 }}
          >
            Error: Data is too large for a single QR code. Maximum capacity
            exceeded.
          </Text>
          <Text
            style={{
              color: "#ccc",
              fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
            }}
          >
            {this.props.value}
          </Text>
        </ScrollView>
      );
    }
    return (
      <QRCode
        value={this.props.value}
        size={qrSize > 100 ? qrSize : 200}
        backgroundColor="white"
        color="black"
        ecl="L"
      />
    );
  }
}

const calculateAverageTeamScore = (
  historyQueue: HistoryItem[],
  targetTeam: string,
): number => {
  const teamMatches = historyQueue.filter(
    (item) => item.teamNum === targetTeam,
  );
  if (teamMatches.length === 0) return 0;

  let totalScore = 0;
  teamMatches.forEach((item) => {
    try {
      const parts = item.qrString.split("|");
      const autoScore = parseInt(parts[5] || "0", 10) * 5;
      const teleScore =
        parseInt(parts[10] || "0", 10) * 2 + parseInt(parts[11] || "0", 10) * 2;
      totalScore += autoScore + teleScore;
    } catch (_e) {}
  });

  return Math.round(totalScore / teamMatches.length);
};

const suggestBallIncrement = (avgScore: number): number => {
  if (avgScore > 200) return 10;
  if (avgScore > 100) return 5;
  return 3;
};

const suggestMinusIncrement = (suggestedPlus: number): number => {
  if (suggestedPlus === 10) return 5;
  if (suggestedPlus === 5) return 3;
  return 1;
};

// Screens
const LoginView = ({
  errorMessage,
  username,
  setUsername,
  handleLogin,
  handleSignUp,
  handleOfflineLogin,
  isLoading,
  password,
  setPassword,
  firstName,
  setFirstName,
  lastName,
  setLastName,
  isSignUpMode,
  setIsSignUpMode,
  teamPassword,
  setTeamPassword,
  apiUrlInput,
  setApiUrlInput,
  onSaveApiUrl,
}: any) => (
  <KeyboardAvoidingView
    behavior={Platform.OS === "ios" ? "padding" : "height"}
    style={{ flex: 1 }}
  >
    <ScrollView
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 20,
      }}
    >
      <View style={styles.card}>
        <Text style={styles.title}>FRC 2026</Text>
        <Text style={styles.subtitle}>
          {isSignUpMode ? "Scouting Sign Up" : "Scouting Login"}
        </Text>

        <Text style={[styles.label, { marginTop: 5 }]}>Backend URL</Text>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginBottom: 5,
            width: "100%",
          }}
        >
          <TextInput
            style={[styles.input, { flex: 1, marginBottom: 0, marginRight: 8 }]}
            placeholder="http://192.0.0.2:8000"
            placeholderTextColor="#666"
            autoCapitalize="none"
            value={apiUrlInput}
            onChangeText={setApiUrlInput}
          />
          <TouchableOpacity
            style={{
              backgroundColor: "#ff9500",
              paddingVertical: 12,
              paddingHorizontal: 14,
              borderRadius: 8,
            }}
            onPress={onSaveApiUrl}
          >
            <Text style={{ color: "white", fontWeight: "bold" }}>Save</Text>
          </TouchableOpacity>
        </View>
        <Text
          style={{
            color: "#888",
            fontSize: 11,
            marginBottom: 15,
            textAlign: "left",
            width: "100%",
          }}
        >
          To get this URL, open VS Code, go to the &quot;Ports&quot; tab
          (usually next to Terminal), add a port for 8000, right-click it to
          change Port Visibility to &quot;Public&quot;, and copy the Forwarded
          Address.
        </Text>

        {errorMessage ? (
          <View
            style={{
              backgroundColor: "#ff3b3033",
              padding: 10,
              borderRadius: 8,
              marginBottom: 15,
              borderWidth: 1,
              borderColor: "#ff3b30",
            }}
          >
            <Text
              style={{
                color: "#ff3b30",
                textAlign: "center",
                fontWeight: "bold",
              }}
            >
              {errorMessage}
            </Text>
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

        <TouchableOpacity
          style={styles.submitBtn}
          onPress={isSignUpMode ? handleSignUp : handleLogin}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>
              {isSignUpMode ? "Sign Up" : "Start Shift"}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setIsSignUpMode(!isSignUpMode)}
          style={{ marginTop: 15, alignItems: "center", padding: 10 }}
        >
          <Text style={{ color: "#0a84ff", fontWeight: "bold" }}>
            {isSignUpMode
              ? "Already have an account? Log In"
              : "Need an account? Sign Up"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleOfflineLogin}
          style={{ marginTop: 5, alignItems: "center", padding: 10 }}
        >
          <Text style={{ color: "#4cd964", fontWeight: "bold" }}>
            Continue Offline (No Account)
          </Text>
        </TouchableOpacity>

        <Text style={styles.tinyText}>
          Requires internet for first login only.
        </Text>
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
  setMatchesScouted,
  textCompression,
  setTextCompression,
}: any) => {
  const progress = Math.min((matchesScouted / SHIFT_LENGTH) * 100, 100);
  const barColor = progress >= 100 ? "#ff3b30" : "#4cd964";

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "flex-end",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <TouchableOpacity
          onPress={() => setIsSettingsOpen(true)}
          style={{
            padding: 8,
            paddingHorizontal: 12,
            backgroundColor: "#333",
            borderRadius: 8,
          }}
        >
          <Text style={{ color: "#fff" }}>⚙️</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleLogout}
          style={{
            padding: 8,
            paddingHorizontal: 12,
            backgroundColor: "#ff3b30",
            borderRadius: 8,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "bold" }}>Logout</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.header, { marginTop: -15 }]}>
        <Text style={styles.title}>Dashboard</Text>
        <Text style={styles.subtitle}>Scouter: {username}</Text>
      </View>

      <View style={styles.cardSection}>
        <Text style={styles.sectionHeader}>Shift Progress</Text>
        <View style={styles.progressBarBg}>
          <View
            style={[
              styles.progressBarFill,
              { width: `${progress}%`, backgroundColor: barColor },
            ]}
          />
        </View>
        <Text style={styles.progressText}>
          {matchesScouted} / {SHIFT_LENGTH} Matches Scouted
        </Text>
        {progress >= 100 && (
          <View style={{ marginTop: 10, alignItems: "center" }}>
            <Text style={styles.alertText}>
              SHIFT COMPLETE! PLEASE SWAP OUT.
            </Text>
            <TouchableOpacity
              onPress={async () => {
                setMatchesScouted(0);
                await AsyncStorage.setItem(`@matches_scouted_${username}`, "0");
              }}
              style={{
                marginTop: 10,
                backgroundColor: "#0a84ff",
                paddingVertical: 8,
                paddingHorizontal: 20,
                borderRadius: 8,
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "bold" }}>
                Reset Counter
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={styles.cardSection}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Text style={styles.sectionHeader}>Select Your Seat</Text>
          {!isSeatUnlocked && (
            <Text style={{ color: "#ff3b30", fontSize: 12 }}>🔒 Locked</Text>
          )}
        </View>
        <View style={styles.stationGrid}>
          {STATIONS.map((s) => (
            <TouchableOpacity
              key={s}
              style={[
                styles.stationBtn,
                station === s ? styles.stationBtnActive : null,
                s.includes("Red") ? styles.borderRed : styles.borderBlue,
                !isSeatUnlocked && station !== s ? { opacity: 0.5 } : null,
              ]}
              onPress={async () => {
                if (isSeatUnlocked) {
                  setStation(s);
                  await AsyncStorage.setItem("@scout_station", s);
                  setIsSeatUnlocked(false);
                  Alert.alert(
                    "Seat Locked",
                    `You are now assigned to ${s}. Seat selection is locked.`,
                  );
                } else {
                  Alert.alert(
                    "Locked",
                    "Seat selection is locked. Ask a lead to unlock it in Settings.",
                  );
                }
              }}
              disabled={!isSeatUnlocked && station !== s}
            >
              <Text style={styles.stationText}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View
        style={[
          styles.cardSection,
          matchQueue.length > 0
            ? { borderColor: "#ffcc00", borderWidth: 1 }
            : {},
        ]}
      >
        <Text
          style={[
            styles.placeholderText,
            {
              fontWeight: "bold",
              color: matchQueue.length > 0 ? "#ffcc00" : "#888",
            },
          ]}
        >
          Matches waiting to scan: {matchQueue.length}
        </Text>
        {matchQueue.length > 0 && (
          <TouchableOpacity
            style={styles.miniBtn}
            onPress={() => setShowQR(true)}
          >
            <Text style={styles.miniBtnText}>Show Batch QR Code</Text>
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity
        style={[styles.submitBtn, { marginTop: 20 }]}
        onPress={onStart}
      >
        <Text style={styles.submitText}>Scout Next Match</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.submitBtn,
          { marginTop: 10, backgroundColor: "#8a2be2" },
        ]}
        onPress={() => setCurrentView("pit")}
      >
        <Text style={styles.submitText}>Pit Scouting Mode</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const ScoutingFormView = ({ form, setForm, station, onSave, onCancel, ballIncrement, setBallIncrement, minusIncrement, setMinusIncrement, historyQueue }: any) => {
  const avgScore = form.teamNumber ? calculateAverageTeamScore(historyQueue || [], form.teamNumber) : 0;
  const suggestedIncrement = avgScore > 0 ? suggestBallIncrement(avgScore) : null;
  const suggestedMinusIncrement = suggestedIncrement ? suggestMinusIncrement(suggestedIncrement) : null;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1 }}
    >
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={onCancel}>
            <Text style={styles.backLink}>← Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{station}</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* --- Increment Settings --- */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Counter Increments</Text>

          {avgScore > 0 ? (
            <View style={{ backgroundColor: '#1a3a2a', padding: 10, borderRadius: 8, marginBottom: 15, borderLeftWidth: 3, borderLeftColor: '#4cd964' }}>
              <Text style={{ color: '#4cd964', fontWeight: 'bold', fontSize: 12 }}>
                Team {form.teamNumber} Avg Score: {avgScore} pts
              </Text>
              <Text style={{ color: '#aaa', fontSize: 11, marginTop: 4 }}>
                Suggested to use: +{suggestedIncrement} and -{suggestedMinusIncrement}
              </Text>
            </View>
          ) : (
            <View style={{ backgroundColor: '#2c2c2c', padding: 10, borderRadius: 8, marginBottom: 15, borderLeftWidth: 3, borderLeftColor: '#666' }}>
              <Text style={{ color: '#aaa', fontSize: 11 }}>
                {form.teamNumber ? `No previous match data internally for Team ${form.teamNumber} yet.` : 'Enter a Team # to see a suggested increment.'}
              </Text>
            </View>
          )}

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>+ Increment</Text>
              <View style={{ flexDirection: 'row', gap: 5 }}>
                 {[1, 3, 5, 10].map(v => (
                    <TouchableOpacity key={"plus"+v} style={[styles.optionBtn, ballIncrement === v ? styles.optionBtnActive : null, { flex: 1, paddingHorizontal: 0, alignItems: 'center' }]} onPress={() => { setBallIncrement(v); AsyncStorage.setItem('@ball_increment', v.toString()); }}>
                       <Text style={[styles.optionBtnText, ballIncrement === v ? styles.textActive : null, { fontSize: 13 }]}>+{v}</Text>
                    </TouchableOpacity>
                 ))}
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>- Increment</Text>
              <View style={{ flexDirection: 'row', gap: 5 }}>
                 {[1, 3, 5].map(v => (
                    <TouchableOpacity key={"minus"+v} style={[styles.optionBtn, minusIncrement === v ? styles.optionBtnActive : null, { flex: 1, paddingHorizontal: 0, alignItems: 'center' }]} onPress={() => { setMinusIncrement(v); AsyncStorage.setItem('@minus_increment', v.toString()); }}>
                       <Text style={[styles.optionBtnText, minusIncrement === v ? styles.textActive : null, { fontSize: 13 }]}>-{v}</Text>
                    </TouchableOpacity>
                 ))}
              </View>
            </View>
          </View>
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
                onChangeText={(t) =>
                  setForm((p: any) => ({ ...p, matchNumber: t }))
                }
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Team #</Text>
              <TextInput
                style={[
                  styles.input,
                  { borderColor: "#0a84ff", borderWidth: 2 },
                ]}
                keyboardType="numeric"
                value={form.teamNumber}
                onChangeText={(t) =>
                  setForm((p: any) => ({ ...p, teamNumber: t }))
                }
              />
            </View>
          </View>
        </View>

        {/* --- Autonomous Phase --- */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Autonomous</Text>

          <Text style={styles.label}>Starting Position</Text>
          <View style={styles.optionRow}>
            {AUTO_POSITIONS.map((opt) => (
              <OptionButton
                key={opt}
                label={opt}
                selected={form.startPos === opt}
                onPress={() => setForm((p: any) => ({ ...p, startPos: opt }))}
              />
            ))}
          </View>

          <View style={styles.divider} />

          <CounterRow label={`Makes (Fuel) +${ballIncrement}`} value={form.autoMake} plusStep={ballIncrement} minusStep={minusIncrement} onChange={(v: number) => setForm((p: any) => ({ ...p, autoMake: Math.max(0, p.autoMake + v) }))} />
          <CounterRow label="Miss (Fuel)" value={form.autoMiss} onChange={(v: number) => setForm((p: any) => ({ ...p, autoMiss: Math.max(0, p.autoMiss + v) }))} />
          
          <Text style={styles.label}>Pass Volume</Text>
          <View style={styles.optionRow}>
            {PASS_VOLUMES.map((opt) => (
              <OptionButton
                key={opt}
                label={opt}
                selected={form.autoPassVol === opt}
                onPress={() =>
                  setForm((p: any) => ({ ...p, autoPassVol: opt }))
                }
              />
            ))}
          </View>

          <View style={styles.divider} />

          <Text style={styles.label}>Collect From:</Text>
          <View style={styles.optionRow}>
            <OptionButton
              label="Outpost"
              selected={form.autoCollect.outpost}
              onPress={() =>
                setForm((p: any) => ({
                  ...p,
                  autoCollect: {
                    ...p.autoCollect,
                    outpost: !p.autoCollect.outpost,
                  },
                }))
              }
            />
            <OptionButton
              label="Depot"
              selected={form.autoCollect.depot}
              onPress={() =>
                setForm((p: any) => ({
                  ...p,
                  autoCollect: {
                    ...p.autoCollect,
                    depot: !p.autoCollect.depot,
                  },
                }))
              }
            />
            <OptionButton
              label="Neutral"
              selected={form.autoCollect.neutral}
              onPress={() =>
                setForm((p: any) => ({
                  ...p,
                  autoCollect: {
                    ...p.autoCollect,
                    neutral: !p.autoCollect.neutral,
                  },
                }))
              }
            />
          </View>

          <View style={styles.divider} />

          <Text style={styles.label}>Auto Climb (30pts)</Text>
          <View style={styles.optionRow}>
            <OptionButton
              label="No"
              selected={form.autoClimb === "None"}
              onPress={() => setForm((p: any) => ({ ...p, autoClimb: "None" }))}
            />
            <OptionButton
              label="YES"
              selected={form.autoClimb === "Yes"}
              onPress={() => setForm((p: any) => ({ ...p, autoClimb: "Yes" }))}
            />
            <OptionButton
              label="Fail"
              selected={form.autoClimb === "Fail"}
              onPress={() => setForm((p: any) => ({ ...p, autoClimb: "Fail" }))}
            />
          </View>

          <Text style={styles.label}>Auto Notes</Text>
          <TextInput
            style={styles.notesInput}
            multiline
            placeholder="Autonomous strategies, failures, path..."
            placeholderTextColor="#888"
            value={form.autoNotes}
            onChangeText={(t) => setForm((p: any) => ({ ...p, autoNotes: t }))}
            maxLength={400}
          />
        </View>

        {/* --- Teleop Phase --- */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Teleop</Text>

          <Text style={styles.label}>Who won Auto?</Text>
          <View style={styles.optionRow}>
            {AUTO_WINNERS.map((opt) => (
              <OptionButton
                key={opt}
                label={opt}
                selected={form.autoWinner === opt}
                onPress={() => setForm((p: any) => ({ ...p, autoWinner: opt }))}
              />
            ))}
          </View>

          <View style={styles.divider} />

          <CounterRow label={`Hits (Fuel) +${ballIncrement}`} value={form.teleMake} plusStep={ballIncrement} minusStep={minusIncrement} onChange={(v: number) => setForm((p: any) => ({ ...p, teleMake: Math.max(0, p.teleMake + v) }))} />
          <CounterRow label="Misses" value={form.teleMiss} onChange={(v: number) => setForm((p: any) => ({ ...p, teleMiss: Math.max(0, p.teleMiss + v) }))} />
          <CounterRow label={`Ferry Volume +${ballIncrement}`} value={form.teleFerry} plusStep={ballIncrement} minusStep={minusIncrement} onChange={(v: number) => setForm((p: any) => ({ ...p, teleFerry: Math.max(0, p.teleFerry + v) }))} />

          <View style={styles.divider} />

          <Text style={styles.label}>Crossings & Play</Text>
          <ToggleRow
            label="Bump"
            checked={form.bumpCross}
            onToggle={() =>
              setForm((p: any) => ({ ...p, bumpCross: !p.bumpCross }))
            }
          />
          <ToggleRow
            label="Trench"
            checked={form.trenchCross}
            onToggle={() =>
              setForm((p: any) => ({ ...p, trenchCross: !p.trenchCross }))
            }
          />
          <ToggleRow
            label="Defended?"
            checked={form.defended}
            onToggle={() =>
              setForm((p: any) => ({ ...p, defended: !p.defended }))
            }
          />

          <View style={styles.divider} />

          <ToggleRow
            label="ROBOT DIED / AFK"
            checked={form.incapacitated}
            color="#ff3b30"
            onToggle={() =>
              setForm((p: any) => ({ ...p, incapacitated: !p.incapacitated }))
            }
          />

          {form.incapacitated && (
            <View style={{ marginTop: 10 }}>
              <Text style={styles.label}>Seconds Dead</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 15"
                placeholderTextColor="#666"
                keyboardType="numeric"
                value={form.deadTime}
                onChangeText={(t) =>
                  setForm((p: any) => ({ ...p, deadTime: t }))
                }
              />
            </View>
          )}

          <Text style={styles.label}>Teleop Notes</Text>
          <TextInput
            style={styles.notesInput}
            multiline
            placeholder="Cycle times, defense played/received..."
            placeholderTextColor="#888"
            value={form.teleNotes}
            onChangeText={(t) => setForm((p: any) => ({ ...p, teleNotes: t }))}
            maxLength={400}
          />
        </View>

        {/* --- Endgame Phase --- */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Endgame</Text>
          <View style={styles.climbContainer}>
            {ENDGAME_ACTIONS.map((level) => (
              <TouchableOpacity
                key={level}
                style={[
                  styles.climbBtn,
                  form.endgameAction === level ? styles.climbBtnActive : null,
                ]}
                onPress={() =>
                  setForm((p: any) => ({ ...p, endgameAction: level }))
                }
              >
                <Text
                  style={[
                    styles.climbBtnText,
                    form.endgameAction === level ? styles.textActive : null,
                  ]}
                >
                  {level}
                </Text>
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
          <CounterRow
            label="Fouls"
            value={form.fouls}
            onChange={(v: number) =>
              setForm((p: any) => ({ ...p, fouls: Math.max(0, p.fouls + v) }))
            }
          />
          <Text style={styles.label}>General Qualitative Notes</Text>
          <Text style={styles.tinyTextLight}>
            Keep it short (max 400 chars) for the QR code
          </Text>
          <TextInput
            style={styles.notesInput}
            multiline
            placeholder="Overall summary, issues, strategy..."
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
  const [currentView, setCurrentView] = useState<ViewState>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [teamPassword, setTeamPassword] = useState("");
  const [isSignUpMode, setIsSignUpMode] = useState(false);
  const [token, setToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [seatKeyInput, setSeatKeyInput] = useState("");
  const [isSeatUnlocked, setIsSeatUnlocked] = useState(false);
  const [masterSeatKey, setMasterSeatKey] = useState("SC-TEAM-SEAT");
  const [_newMasterKeyInput, _setNewMasterKeyInput] = useState("");
  const [textCompression, setTextCompression] = useState("Default");
  const [ballIncrement, setBallIncrement] = useState(5);
  const [minusIncrement, setMinusIncrement] = useState(1);

  const [station, setStation] = useState<Station | "">("");
  const [matchesScouted, setMatchesScouted] = useState(0);

  const [matchQueue, setMatchQueue] = useState<HistoryItem[]>([]);
  const [historyQueue, setHistoryQueue] = useState<HistoryItem[]>([]);
  const [showQR, setShowQR] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [logoutInput, setLogoutInput] = useState("");
  const [logoutKeyInput, setLogoutKeyInput] = useState("");

  const [schedule, setSchedule] = useState<any>(DEFAULT_SCHEDULE);
  const [tbaEventKey, setTbaEventKey] = useState("");
  const [isFetchingTba, setIsFetchingTba] = useState(false);

  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [apiUrlInput, setApiUrlInput] = useState("");

  const [form, setForm] = useState<MatchData>(INITIAL_MATCH_DATA);

  useEffect(() => {
    AsyncStorage.getItem("@scout_username").then((u) => {
      if (u) {
        setUsername(u);
        setCurrentView("dashboard");
      }
    });
    AsyncStorage.getItem("@scout_station").then((s) => {
      if (s) setStation(s as Station);
    });
    AsyncStorage.getItem("@match_schedule").then((s) => {
      if (s) {
        try {
          setSchedule(JSON.parse(s));
        } catch (_e) {
          console.log("Failed to parse saved schedule");
        }
      }
    });
    AsyncStorage.getItem("@master_seat_key").then((k) => {
      if (k) setMasterSeatKey(k);
    });
    AsyncStorage.getItem('@ball_increment').then(bi => { if (bi) setBallIncrement(parseInt(bi, 10)); });
    AsyncStorage.getItem('@minus_increment').then(mi => { if (mi) setMinusIncrement(parseInt(mi, 10)); });
    AsyncStorage.getItem('@refresh_token').then(t => {
      if (t) setRefreshToken(t);
    });
    AsyncStorage.getItem("@text_compression").then((c) => {
      if (c) setTextCompression(c);
    });
    AsyncStorage.getItem("@tba_event_key").then((k) => {
      if (k) setTbaEventKey(k);
    });
    AsyncStorage.getItem("@api_url").then((u) => {
      if (u) {
        setApiUrl(u);
        setApiUrlInput(u);
      } else {
        setApiUrlInput(DEFAULT_API_URL);
      }
    });
  }, []);

  useEffect(() => {
    if (username) {
      AsyncStorage.getItem(`@match_queue_${username}`).then((q) => {
        if (q) setMatchQueue(JSON.parse(q));
        else setMatchQueue([]);
      });
      AsyncStorage.getItem(`@match_history_${username}`).then((h) => {
        if (h) setHistoryQueue(JSON.parse(h));
        else setHistoryQueue([]);
      });
      AsyncStorage.getItem(`@matches_scouted_${username}`).then((m) => {
        if (m) setMatchesScouted(parseInt(m, 10));
        else setMatchesScouted(0);
      });
    } else {
      setMatchQueue([]);
      setHistoryQueue([]);
      setMatchesScouted(0);
    }
  }, [username]);

  useEffect(() => {
    if (form.matchType === 'Qual' && station) {
      if (schedule && schedule[form.matchNumber] && schedule[form.matchNumber][station]) {
        const assigned = schedule[form.matchNumber][station];
        setForm(p => ({ ...p, teamNumber: assigned, station }));
      } else if (schedule && Object.keys(schedule).length > 0) {
        setForm(p => ({ ...p, teamNumber: '', station }));
      }
    }
  }, [form.matchNumber, station, form.matchType]);

  const handleLogin = async () => {
    setErrorMessage("");
    if (!username || !password) {
      const msg = "Please enter username and password";
      setErrorMessage(msg);
      Alert.alert("Error", msg);
      return;
    }
    setIsLoading(true);
    const targetUrl = `${apiUrl}/auth/login`;
    try {
      const res = await fetchWithTimeout(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username, password: password }),
      });
      const data = await res.json();

      if (res.status === 201) {
        setToken(data.accessToken);
        setRefreshToken(data.refreshToken);
        await AsyncStorage.setItem("@scout_username", username);
        await AsyncStorage.setItem("@refresh_token", data.refreshToken);
        setCurrentView("dashboard");
      } else {
        const msg = data.code || `Login failed (HTTP ${res.status})`;
        setErrorMessage(msg);
        Alert.alert("Error", msg);
      }
    } catch (e: any) {
      const msg = `Could not reach backend.\n\nURL: ${targetUrl}\nError: ${e.message}`;
      setErrorMessage(msg);
      Alert.alert("Network Error", msg);
    }
    setIsLoading(false);
  };

  const handleOfflineLogin = async () => {
    setUsername("OfflineScouter");
    setToken("offline-token");
    await AsyncStorage.setItem("@scout_username", "OfflineScouter");
    setCurrentView("dashboard");
  };

  const handleSignUp = async () => {
    setErrorMessage("");
    if (!username || !password || !firstName || !lastName || !teamPassword) {
      const msg = "Please fill out all fields";
      setErrorMessage(msg);
      Alert.alert("Error", msg);
      return;
    }

    setIsLoading(true);
    const targetUrl = `${apiUrl}/auth/sign-up`;
    try {
      const res = await fetchWithTimeout(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          firstName,
          lastName,
          teamPassword,
        }),
      });
      const data = await res.json();

      if (res.status === 201) {
        setToken(data.accessToken);
        setRefreshToken(data.refreshToken);
        await AsyncStorage.setItem("@scout_username", username);
        await AsyncStorage.setItem("@refresh_token", data.refreshToken);
        setCurrentView("dashboard");
      } else {
        const msg = data.code || `Sign up failed (HTTP ${res.status})`;
        setErrorMessage(msg);
        Alert.alert("Error", msg);
      }
    } catch (e: any) {
      const msg = `Could not reach backend.\n\nURL: ${targetUrl}\nError: ${e.message}`;
      setErrorMessage(msg);
      Alert.alert("Network Error", msg);
    }
    setIsLoading(false);
  };

  const handleLogout = async () => {
    try {
      if (refreshToken) {
        await fetch(`${apiUrl}/auth/logout`, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: refreshToken,
        });
      }
    } catch (_e) {}

    await AsyncStorage.removeItem("@scout_username");
    await AsyncStorage.removeItem("@refresh_token");
    setUsername("");
    setPassword("");
    setToken("");
    setRefreshToken("");
    setIsSeatUnlocked(false);
    setCurrentView("login");
  };

  const handleSaveMatch = async () => {
    if (!form.teamNumber || !form.matchNumber) {
      Alert.alert("Missing Info", "Check Team/Match Number");
      return;
    }

    const effectiveDeadTime = form.incapacitated ? form.deadTime || "150" : "0";

    const extraData = `[Start:${form.startPos}] [Pass:${form.autoPassVol}] [AutoWin:${form.autoWinner}] [Ferry:${form.teleFerry}] [Bump:${form.bumpCross}] [Trench:${form.trenchCross}] [Defended:${form.defended}] [Time:${form.climbTime || "0"}s] [Dead:${form.incapacitated ? "DIE" : "OK"}]`;
    const parsedNotes = form.notes.replace(/\|/g, "");

    // Prevent any delimiters breaking the payload
    const safeAutoNotes = form.autoNotes.replace(/\|/g, "");
    const safeTeleNotes = form.teleNotes.replace(/\|/g, "");
    const fullNotes = parsedNotes ? parsedNotes : `${extraData} | `;

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
      form.autoPassVol,                                          // 8  
      form.autoWinner,                                           // 9  
      form.teleMake,                                             // 10
      form.teleFerry,                                            // 11 
      form.bumpCross,                                            // 12 
      form.trenchCross,                                          // 13 
      form.endgameAction,                                        // 14
      form.climbTime || "0",                                     // 15 
      form.incapacitated ? 'DIE' : 'OK',                         // 16 
      fullNotes,                                                 // 17 (Notes)
      safeAutoNotes,                                             // 18 (Auto Notes specifically)
      safeTeleNotes,                                             // 19 (Teleop Notes specifically)
      form.defended,                                             // 20
      station,                                                   // 21
      form.fouls                                                 // 22
    ].join('|');

    // Attempt to submit to backend real-time matching the required schema strictly
    const reportPayload = {
      createdAt: new Date().toISOString(),
      eventCode: form.eventCode.substring(0, 5).padEnd(5, "A"),
      matchType: form.matchType === "Play" ? "PLAYOFF" : "QUALIFICATION",
      matchNumber: parseInt(form.matchNumber || "1", 10),
      alliance: station && station.startsWith('Blue') ? 'BLUE' : 'RED',
      teamNumber: parseInt(form.teamNumber || "1", 10),
      inMatch: true,
      notes: fullNotes.substring(0, 400),
      minorFouls: form.fouls,
      majorFouls: 0,
      secondsIncapacitated: parseInt(effectiveDeadTime, 10),
      shootingConfidence: 3,
      auto: {
        notes: safeAutoNotes.substring(0, 400),
        hubScores: form.autoMake,
        hubMisses: form.autoMiss,
        climb: form.autoClimb === 'Yes' ? 'LEVEL1' : (form.autoClimb === 'Fail' ? 'FAILED' : 'NONE'),
        passes: form.autoPassVol === 'High' ? 3 : (form.autoPassVol === 'Med' ? 2 : (form.autoPassVol === 'Low' ? 1 : 0)),
      },
      teleop: {
        notes: safeTeleNotes.substring(0, 400),
        hubScores: form.teleMake,
        hubMisses: form.teleMiss,
        level: 0,
        climbFailed: false,
        defended: form.defended,
        wasDefended: false,
        passes: form.teleFerry,
      },
      endgame: {
        notes: "",
        level:
          form.endgameAction === "Level 3"
            ? 3
            : form.endgameAction === "Level 2"
              ? 2
              : form.endgameAction === "Level 1"
                ? 1
                : 0,
        climbFailed: form.endgameAction === "Failed",
      },
    };

    console.log(
      "[DEBUG] Payload Sent to API via index.tsx:",
      JSON.stringify(reportPayload, null, 2),
    );

    try {
      if (token) {
        let res = await fetch(`${apiUrl}/report`, {
          method: 'POST',
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(reportPayload),
        });

        if (res.status === 401 && refreshToken) {
          try {
            const refreshRes = await fetch(`${apiUrl}/auth/refresh`, {
              method: 'POST',
              headers: { 'Content-Type': 'text/plain' },
              body: refreshToken
            });
            if (refreshRes.status === 201) {
               const data = await refreshRes.json();
               setToken(data.accessToken);
               setRefreshToken(data.refreshToken);
               await AsyncStorage.setItem('@refresh_token', data.refreshToken);
               res = await fetch(`${apiUrl}/report`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${data.accessToken}`
                  },
                  body: JSON.stringify(reportPayload)
               });
            }
          } catch(e) {
            console.warn("Failed to refresh token", e);
          }
        }
        
        if (res.status !== 201) {
          console.warn("Failed to submit report to backend online");
        }
      }
    } catch (_err) {
      console.warn("Could not reach backend, relying only on QR queue");
    }

    const newRecord: HistoryItem = {
      id: Date.now().toString(),
      matchNum: form.matchNumber,
      teamNum: form.teamNumber,
      qrString: dataString,
    };

    // Save to device storage
    const newQueue = [...matchQueue, newRecord];
    setMatchQueue(newQueue);
    await AsyncStorage.setItem(
      `@match_queue_${username}`,
      JSON.stringify(newQueue),
    );

    const newHistory = [...historyQueue, newRecord];
    setHistoryQueue(newHistory);
    await AsyncStorage.setItem(
      `@match_history_${username}`,
      JSON.stringify(newHistory),
    );

    const newMatchesScouted = matchesScouted + 1;
    setMatchesScouted(newMatchesScouted);
    await AsyncStorage.setItem(
      `@matches_scouted_${username}`,
      newMatchesScouted.toString(),
    );

    // Automatically increment the match number for the next round
    const nextMatch = (parseInt(form.matchNumber, 10) + 1).toString();

    // Check if the scouter is building up too many local un-scanned codes
    if (newQueue.length >= 3) {
      Alert.alert(
        "Scan Required!",
        `You have ${newQueue.length} unsynced matches waiting on your device! Please hold up your tablet and ask the lead scouter to scan your QR code.`,
        [
          { text: "Scan Now", onPress: () => setShowQR(true) },
          { text: "Later", style: "cancel" },
        ],
      );
    }

    // Wipe out the old data, but keep the meta data (like the new match number)
    setForm({
      ...INITIAL_MATCH_DATA,
      matchNumber: nextMatch,
    });

    setCurrentView("dashboard");
  };

  const clearQueue = async () => {
    setMatchQueue([]);
    await AsyncStorage.setItem(`@match_queue_${username}`, "[]");
    setShowQR(false);
  };

  const handleFetchTba = async () => {
    const tbaApiKey = process.env.EXPO_PUBLIC_TBA_API_KEY;
    if (!tbaEventKey || !tbaApiKey) {
      Alert.alert(
        "Missing Info",
        "Please provide a TBA Event Key. The API key must be set in the .env file as EXPO_PUBLIC_TBA_API_KEY.",
      );
      return;
    }

    setIsFetchingTba(true);
    try {
      await AsyncStorage.setItem("@tba_event_key", tbaEventKey);

      const res = await fetch(
        `https://www.thebluealliance.com/api/v3/event/${tbaEventKey}/matches/simple`,
        {
          headers: {
            "X-TBA-Auth-Key": tbaApiKey,
          },
        },
      );

      if (!res.ok) {
        throw new Error(`Failed to fetch from TBA: ${res.status}`);
      }

      const data = await res.json();
      const newSchedule: any = {};

      data.forEach((match: any) => {
        if (match.comp_level === "qm") {
          const matchNum = match.match_number;
          const redTeams = match.alliances.red.team_keys.map((k: string) =>
            k.replace("frc", ""),
          );
          const blueTeams = match.alliances.blue.team_keys.map((k: string) =>
            k.replace("frc", ""),
          );

          newSchedule[matchNum] = {
            Red1: redTeams[0],
            Red2: redTeams[1],
            Red3: redTeams[2],
            Blue1: blueTeams[0],
            Blue2: blueTeams[1],
            Blue3: blueTeams[2],
          };
        }
      });

      setSchedule(newSchedule);
      await AsyncStorage.setItem(
        "@match_schedule",
        JSON.stringify(newSchedule),
      );
      Alert.alert(
        "Success",
        `Loaded schedule for ${Object.keys(newSchedule).length} qualification matches!`,
      );
    } catch (e: any) {
      Alert.alert("TBA Error", e.message || "Could not fetch match schedule.");
    }
    setIsFetchingTba(false);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Settings Modal */}
      <Modal visible={isSettingsOpen} animationType="slide" transparent={true}>
        <View style={styles.modalContainer}>
          <View
            style={[
              styles.modalContent,
              { maxHeight: "90%", paddingBottom: 20 },
            ]}
          >
            <Text style={styles.modalTitle}>Settings / Seat Admin</Text>

            <ScrollView
              style={{ width: "100%" }}
              contentContainerStyle={{ paddingBottom: 20 }}
              showsVerticalScrollIndicator={true}
            >
              <View style={{ marginBottom: 30, width: "100%" }}>
                <Text style={styles.label}>Unlock Seat Selection</Text>
                <Text style={{ color: "#888", fontSize: 12, marginBottom: 5 }}>
                  Only leads should know this code.
                </Text>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <TextInput
                    style={[
                      styles.input,
                      { flex: 1, marginBottom: 0, minHeight: 50 },
                    ]}
                    placeholder="Master Key"
                    placeholderTextColor="#888"
                    secureTextEntry
                    autoCapitalize="none"
                    value={seatKeyInput}
                    onChangeText={setSeatKeyInput}
                  />
                  <TouchableOpacity
                    style={{
                      backgroundColor: "#0a84ff",
                      paddingHorizontal: 20,
                      justifyContent: "center",
                      borderRadius: 8,
                    }}
                    onPress={() => {
                      if (seatKeyInput === masterSeatKey) {
                        setIsSeatUnlocked(true);
                        setSeatKeyInput("");
                        setIsSettingsOpen(false);
                        Alert.alert("Success", "Seat selection unlocked!");
                      } else {
                        Alert.alert("Error", "Incorrect key.");
                      }
                    }}
                  >
                    <Text style={{ color: "white", fontWeight: "bold" }}>
                      Unlock
                    </Text>
                  </TouchableOpacity>
                </View>
                {isSeatUnlocked && (
                  <Text style={{ color: "#4cd964", marginTop: 5 }}>
                    ✓ Currently Unlocked
                  </Text>
                )}
              </View>

              <View
                style={{
                  marginBottom: 30,
                  width: "100%",
                  borderTopWidth: 1,
                  borderTopColor: "#333",
                  paddingTop: 15,
                }}
              >
                <Text style={styles.label}>QR Code Text Compression</Text>
                <Text style={{ color: "#888", fontSize: 12, marginBottom: 10 }}>
                  If the batch code is too big to scan, turn this up.
                </Text>
                <View
                  style={{
                    flexDirection: "row",
                    gap: 10,
                    justifyContent: "center",
                  }}
                >
                  {["Default", "High", "Extreme"].map((lvl) => (
                    <TouchableOpacity
                      key={lvl}
                      style={[
                        styles.optionBtn,
                        textCompression === lvl ? styles.optionBtnActive : null,
                        { flex: 1, alignItems: "center" },
                      ]}
                      onPress={() => {
                        setTextCompression(lvl);
                        AsyncStorage.setItem("@text_compression", lvl);
                      }}
                    >
                      <Text
                        style={[
                          styles.optionBtnText,
                          textCompression === lvl ? styles.textActive : null,
                          { fontSize: 12 },
                        ]}
                      >
                        {lvl}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View
                style={{
                  marginBottom: 30,
                  width: "100%",
                  borderTopWidth: 1,
                  borderTopColor: "#333",
                  paddingTop: 15,
                }}
              >
                <Text style={styles.label}>Backend API URL</Text>
                <Text style={{ color: "#888", fontSize: 12, marginBottom: 5 }}>
                  e.g. http://192.168.1.55:8000
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    { marginBottom: 10, flex: 0, minHeight: 50 },
                  ]}
                  placeholder="http://..."
                  placeholderTextColor="#666"
                  autoCapitalize="none"
                  value={apiUrlInput}
                  onChangeText={setApiUrlInput}
                />
                <TouchableOpacity
                  style={{
                    backgroundColor: "#ff9500",
                    padding: 10,
                    borderRadius: 8,
                    alignItems: "center",
                  }}
                  onPress={async () => {
                    let cleaned = apiUrlInput.trim();
                    if (cleaned.endsWith("/")) cleaned = cleaned.slice(0, -1);
                    setApiUrl(cleaned);
                    setApiUrlInput(cleaned);
                    await AsyncStorage.setItem("@api_url", cleaned);
                    Alert.alert("Success", "API URL Updated!");
                  }}
                >
                  <Text style={{ color: "white", fontWeight: "bold" }}>
                    Save API URL
                  </Text>
                </TouchableOpacity>
              </View>

              <View
                style={{
                  marginBottom: 30,
                  width: "100%",
                  borderTopWidth: 1,
                  borderTopColor: "#333",
                  paddingTop: 15,
                }}
              >
                <Text style={styles.label}>Fetch TBA Match Schedule</Text>
                <Text style={{ color: "#888", fontSize: 12, marginBottom: 5 }}>
                  Enter Event Key (e.g. 2024casj)
                </Text>

                <TextInput
                  style={[
                    styles.input,
                    { marginBottom: 10, flex: 0, minHeight: 50 },
                  ]}
                  placeholder="TBA Event Key (e.g. 2024casj)"
                  placeholderTextColor="#666"
                  autoCapitalize="none"
                  value={tbaEventKey}
                  onChangeText={setTbaEventKey}
                />
                <TouchableOpacity
                  style={{
                    backgroundColor:
                      Object.keys(schedule).length > 0 ? "#4cd964" : "#ff9500",
                    padding: 10,
                    borderRadius: 8,
                    alignItems: "center",
                  }}
                  onPress={handleFetchTba}
                  disabled={isFetchingTba}
                >
                  {isFetchingTba ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={{ color: "white", fontWeight: "bold" }}>
                      {Object.keys(schedule).length > 0
                        ? `Refetch TBA Schedule`
                        : "Fetch TBA Schedule"}
                    </Text>
                  )}
                </TouchableOpacity>
                {Object.keys(schedule).length > 0 && (
                  <Text
                    style={{
                      color: "#4cd964",
                      textAlign: "center",
                      marginTop: 10,
                      fontSize: 12,
                    }}
                  >
                    ✓ {Object.keys(schedule).length} matches dynamically loaded
                  </Text>
                )}
              </View>

              <View
                style={{
                  marginBottom: 30,
                  width: "100%",
                  borderTopWidth: 1,
                  borderTopColor: "#333",
                  paddingTop: 15,
                }}
              >
                <Text style={styles.label}>Ball Increment Setting</Text>
                <Text style={{ color: "#888", fontSize: 12, marginBottom: 10 }}>
                  Adjust how many balls/fuel increment per button press
                </Text>

                {(() => {
                  const avgScore = form.teamNumber
                    ? calculateAverageTeamScore(historyQueue, form.teamNumber)
                    : 0;
                  const suggested =
                    avgScore > 0 ? suggestBallIncrement(avgScore) : 5;
                  return (
                    <>
                      {avgScore > 0 && (
                        <View
                          style={{
                            backgroundColor: "#1a3a2a",
                            padding: 10,
                            borderRadius: 8,
                            marginBottom: 10,
                            borderLeftWidth: 3,
                            borderLeftColor: "#4cd964",
                          }}
                        >
                          <Text
                            style={{
                              color: "#4cd964",
                              fontWeight: "bold",
                              fontSize: 12,
                            }}
                          >
                            Team {form.teamNumber} Avg Score: {avgScore} pts
                          </Text>
                          <Text
                            style={{
                              color: "#aaa",
                              fontSize: 11,
                              marginTop: 4,
                            }}
                          >
                            Suggested increment: +{suggested}
                          </Text>
                        </View>
                      )}
                    </>
                  );
                })()}

                <View style={{ flexDirection: "row", gap: 8 }}>
                  {[1, 3, 5, 10].map((inc) => (
                    <TouchableOpacity
                      key={inc}
                      style={[
                        styles.optionBtn,
                        { flex: 1, alignItems: "center" },
                        ballIncrement === inc ? styles.optionBtnActive : null,
                      ]}
                      onPress={async () => {
                        setBallIncrement(inc);
                        await AsyncStorage.setItem(
                          "@ball_increment",
                          inc.toString(),
                        );
                      }}
                    >
                      <Text
                        style={[
                          styles.optionBtnText,
                          ballIncrement === inc ? styles.textActive : null,
                        ]}
                      >
                        +{inc}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View
                style={{
                  marginBottom: 30,
                  width: "100%",
                  borderTopWidth: 1,
                  borderTopColor: "#333",
                  paddingTop: 15,
                }}
              >
                <TouchableOpacity
                  style={{
                    backgroundColor: "#2b5c35",
                    padding: 15,
                    borderRadius: 8,
                    alignItems: "center",
                  }}
                  onPress={() => {
                    setIsSettingsOpen(false);
                    setIsHistoryOpen(true);
                  }}
                >
                  <Text style={{ color: "white", fontWeight: "bold" }}>
                    Open Overview of Past Match Details
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>

            <TouchableOpacity
              style={[
                styles.closeBtn,
                { backgroundColor: "#444", marginTop: 10 },
              ]}
              onPress={() => setIsSettingsOpen(false)}
            >
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
            <Text style={styles.modalSubtitle}>
              {matchQueue.length} Matches Saved
            </Text>

            <View style={styles.qrContainer}>
              {matchQueue.length > 0 && (
                <QRCodeWrapper
                  value={matchQueue.map((m) => m.qrString).join("#")}
                />
              )}
            </View>

            <TouchableOpacity
              style={[styles.closeBtn, { backgroundColor: "#2b5c35" }]}
              onPress={clearQueue}
            >
              <Text style={styles.closeBtnText}>✓ Clear Queue (Scanned)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.closeBtn,
                { backgroundColor: "#444", marginTop: 10 },
              ]}
              onPress={() => setShowQR(false)}
            >
              <Text style={styles.closeBtnText}>✕ Close (Scan Later)</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* History Modal */}
      <Modal visible={isHistoryOpen} animationType="slide" transparent={true}>
        <View style={styles.modalContainer}>
          <View style={[styles.modalContent, { maxHeight: "90%" }]}>
            <Text style={styles.modalTitle}>Past Match Details</Text>
            <Text style={styles.modalSubtitle}>
              {historyQueue.length} Matches in History
            </Text>

            <ScrollView style={{ width: "100%", marginBottom: 15 }}>
              {historyQueue.map((item, _idx) => (
                <View
                  key={item.id}
                  style={{
                    backgroundColor: "#2c2c2c",
                    padding: 15,
                    borderRadius: 8,
                    marginBottom: 10,
                  }}
                >
                  <Text
                    style={{ color: "#fff", fontWeight: "bold", fontSize: 16 }}
                  >
                    Match {item.matchNum} | Team {item.teamNum}
                  </Text>
                  <Text style={{ color: "#aaa", marginTop: 5, fontSize: 12 }}>
                    Raw Data:
                  </Text>
                  <Text
                    style={{
                      color: "#888",
                      fontFamily:
                        Platform.OS === "ios" ? "Courier" : "monospace",
                      fontSize: 10,
                      marginTop: 2,
                    }}
                  >
                    {item.qrString}
                  </Text>
                  <View
                    style={{
                      marginTop: 10,
                      padding: 5,
                      backgroundColor: "#fff",
                      alignSelf: "flex-start",
                    }}
                  >
                    <QRCodeWrapper value={item.qrString} size={100} />
                  </View>
                </View>
              ))}
              {historyQueue.length === 0 && (
                <Text
                  style={{ color: "#888", textAlign: "center", marginTop: 20 }}
                >
                  No matches saved yet.
                </Text>
              )}
            </ScrollView>

            <TouchableOpacity
              style={[styles.closeBtn, { backgroundColor: "#444" }]}
              onPress={() => setIsHistoryOpen(false)}
            >
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Logout Confirmation Modal */}
      <Modal
        visible={showLogoutConfirm}
        animationType="fade"
        transparent={true}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Confirm Logout</Text>
            <Text
              style={{
                color: "#ff3b30",
                textAlign: "center",
                marginBottom: 15,
              }}
            >
              Are you sure? If you are at a competition without WiFi, you will
              not be able to log back in!
            </Text>
            <Text style={styles.label}>
              Type &quot;LOGOUT&quot; to confirm:
            </Text>
            <TextInput
              style={[
                styles.input,
                { marginBottom: 10, flex: 0, minHeight: 50, width: "100%" },
              ]}
              placeholder="LOGOUT"
              placeholderTextColor="#666"
              autoCapitalize="characters"
              value={logoutInput}
              onChangeText={setLogoutInput}
            />
            <Text style={styles.label}>Enter your Seat Key to verify:</Text>
            <TextInput
              style={[
                styles.input,
                { marginBottom: 20, flex: 0, minHeight: 50, width: "100%" },
              ]}
              placeholder="••••••••••••"
              placeholderTextColor="#666"
              autoCapitalize="characters"
              secureTextEntry={true}
              value={logoutKeyInput}
              onChangeText={setLogoutKeyInput}
            />
            <View style={{ flexDirection: "row", gap: 10, width: "100%" }}>
              <TouchableOpacity
                style={[styles.closeBtn, { flex: 1, backgroundColor: "#444" }]}
                onPress={() => {
                  setShowLogoutConfirm(false);
                  setLogoutInput("");
                  setLogoutKeyInput("");
                }}
              >
                <Text style={styles.closeBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.closeBtn,
                  {
                    flex: 1,
                    backgroundColor:
                      logoutInput === "LOGOUT" &&
                      logoutKeyInput === masterSeatKey
                        ? "#ff3b30"
                        : "#333",
                  },
                ]}
                disabled={
                  logoutInput !== "LOGOUT" || logoutKeyInput !== masterSeatKey
                }
                onPress={() => {
                  setShowLogoutConfirm(false);
                  setLogoutInput("");
                  setLogoutKeyInput("");
                  handleLogout();
                }}
              >
                <Text style={styles.closeBtnText}>Logout</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* View Routing */}
      {currentView === "login" && (
        <LoginView
          errorMessage={errorMessage}
          username={username}
          setUsername={setUsername}
          handleLogin={handleLogin}
          handleSignUp={handleSignUp}
          handleOfflineLogin={handleOfflineLogin}
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
            setErrorMessage("");
          }}
          apiUrlInput={apiUrlInput}
          setApiUrlInput={setApiUrlInput}
          onSaveApiUrl={async () => {
            let cleaned = apiUrlInput.trim();
            if (cleaned.endsWith("/")) cleaned = cleaned.slice(0, -1);
            setApiUrl(cleaned);
            setApiUrlInput(cleaned);
            await AsyncStorage.setItem("@api_url", cleaned);
            Alert.alert("Success", "API URL Updated!");
          }}
        />
      )}

      {currentView === "dashboard" && (
        <DashboardView
          username={username}
          matchesScouted={matchesScouted}
          station={station || "None"}
          setStation={setStation}
          matchQueue={matchQueue}
          setShowQR={setShowQR}
          onStart={() => {
            if (!station) {
              Alert.alert(
                "Seat Required",
                "Please ask a lead to unlock and select a seat before scouting.",
              );
              return;
            }
            setCurrentView("scouting");
          }}
          setCurrentView={setCurrentView}
          handleLogout={() => setShowLogoutConfirm(true)}
          setIsSettingsOpen={setIsSettingsOpen}
          isSeatUnlocked={isSeatUnlocked || !station}
          setIsSeatUnlocked={setIsSeatUnlocked}
          textCompression={textCompression}
          setTextCompression={setTextCompression}
          setMatchesScouted={setMatchesScouted}
        />
      )}

      {currentView === "scouting" && (
        <ScoutingFormView
          form={form}
          setForm={setForm}
          station={station}
          onSave={handleSaveMatch}
          onCancel={() => setCurrentView("dashboard")}
          ballIncrement={ballIncrement}
          setBallIncrement={setBallIncrement}
          minusIncrement={minusIncrement}
          setMinusIncrement={setMinusIncrement}
          historyQueue={historyQueue}
        />
      )}

      {currentView === "pit" && (
        <PitScoutingView
          onBack={() => setCurrentView("dashboard")}
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
    backgroundColor: "#121212",
  },
  container: {
    padding: 20,
    maxWidth: 600,
    width: "100%",
    alignSelf: "center",
    paddingBottom: 50,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: "#1e1e1e",
    padding: 30,
    borderRadius: 15,
  },
  section: {
    backgroundColor: "#1e1e1e",
    padding: 15,
    borderRadius: 12,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: "#333",
  },
  cardSection: {
    backgroundColor: "#1e1e1e",
    padding: 15,
    borderRadius: 12,
    marginBottom: 15,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 16,
    color: "#888",
    marginBottom: 25,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#fff",
  },
  sectionHeader: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#333",
    paddingBottom: 5,
  },
  label: {
    color: "#bbb",
    fontSize: 14,
    marginBottom: 8,
    marginTop: 5,
  },
  backLink: {
    color: "#0a84ff",
    fontSize: 16,
  },
  progressText: {
    color: "#ccc",
    textAlign: "center",
    fontSize: 12,
    marginTop: 5,
  },
  alertText: {
    color: "#ff3b30",
    fontWeight: "bold",
    textAlign: "center",
    marginTop: 5,
  },
  placeholderText: {
    color: "#666",
    fontStyle: "italic",
  },
  header: {
    marginBottom: 20,
    alignItems: "center",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  inputRow: {
    flexDirection: "row",
    gap: 10,
  },
  optionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 15,
  },
  divider: {
    height: 1,
    backgroundColor: "#333",
    marginVertical: 15,
  },
  input: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#2c2c2c",
    color: "#fff",
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#444",
  },
  notesInput: {
    borderWidth: 1,
    borderColor: "#444",
    borderRadius: 8,
    padding: 10,
    height: 80,
    textAlignVertical: "top",
    backgroundColor: "#2c2c2c",
    color: "#fff",
  },
  counterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 15,
  },
  counterLabel: {
    fontSize: 16,
    color: "#ddd",
    flex: 1,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  countValue: {
    fontSize: 24,
    fontWeight: "bold",
    minWidth: 50,
    textAlign: "center",
    color: "#fff",
  },
  btn: {
    width: 60,
    height: 60,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 30,
  },
  btnMinus: {
    backgroundColor: "#3a2a2a",
    borderWidth: 1,
    borderColor: "#ff3b30",
  },
  btnPlus: {
    backgroundColor: "#2a3a2a",
    borderWidth: 1,
    borderColor: "#4cd964",
  },
  btnText: {
    fontSize: 30,
    fontWeight: "bold",
    color: "#fff",
  },
  submitBtn: {
    backgroundColor: "#0a84ff",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    width: "100%",
  },
  submitText: {
    color: "white",
    fontSize: 18,
    fontWeight: "bold",
  },
  optionBtn: {
    backgroundColor: "#2c2c2c",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#444",
  },
  optionBtnActive: {
    backgroundColor: "#0a84ff",
    borderColor: "#0a84ff",
  },
  optionBtnText: {
    color: "#ccc",
    fontSize: 14,
    fontWeight: "600",
  },
  textActive: {
    color: "#fff",
  },
  climbContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  climbBtn: {
    flex: 1,
    minWidth: "40%",
    backgroundColor: "#2c2c2c",
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#444",
  },
  climbBtnActive: {
    backgroundColor: "#0a84ff",
    borderColor: "#0a84ff",
  },
  climbBtnText: {
    color: "#ccc",
    fontWeight: "600",
  },
  stationGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "center",
  },
  stationBtn: {
    width: "30%",
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    borderColor: "#444",
  },
  stationBtnActive: {
    backgroundColor: "#333",
  },
  borderRed: {
    borderColor: "#ff3b30",
  },
  borderBlue: {
    borderColor: "#0a84ff",
  },
  stationText: {
    color: "#fff",
    fontWeight: "bold",
  },
  checkboxRow: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#252525",
    borderWidth: 1,
    borderColor: "#333",
  },
  checkboxIcon: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#fff",
  },
  progressBarBg: {
    height: 10,
    backgroundColor: "#333",
    borderRadius: 5,
    overflow: "hidden",
    marginVertical: 10,
  },
  progressBarFill: {
    height: "100%",
  },
  miniBtn: {
    marginTop: 10,
    padding: 8,
    backgroundColor: "#333",
    borderRadius: 6,
    alignItems: "center",
  },
  miniBtnText: {
    color: "#aaa",
    fontSize: 12,
  },
  modalContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.95)",
  },
  modalContent: {
    width: "90%",
    backgroundColor: "#1e1e1e",
    borderRadius: 15,
    padding: 20,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#444",
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 5,
  },
  modalSubtitle: {
    fontSize: 16,
    color: "#ffcc00",
    marginBottom: 20,
  },
  qrContainer: {
    padding: 10,
    backgroundColor: "white",
    borderRadius: 10,
    marginBottom: 20,
  },
  closeBtn: {
    padding: 15,
    borderRadius: 10,
    width: "100%",
    alignItems: "center",
  },
  closeBtnText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
  },
  tinyText: {
    color: "#666",
    fontSize: 12,
    marginTop: 15,
    fontStyle: "italic",
  },
  tinyTextLight: {
    color: "#888",
    fontSize: 12,
    marginBottom: 5,
    fontStyle: "italic",
  },
});
