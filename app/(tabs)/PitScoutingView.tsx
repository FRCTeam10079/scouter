import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';

// CONFIG
const API_URL = 'http://localhost:8000'; // Change to your IP if needed

export default function PitScoutingView({ onBack, username, token }: any) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    teamNumber: '',
    drivetrain: 'Swerve', // Default
    weight: '',
    width: '',
    length: '',
    autoRoutines: '',
    canClimb: false,
    notes: ''
  });

  const handleSave = async () => {
    if (!form.teamNumber) return Alert.alert("Error", "Enter Team Number");

    setLoading(true);

    // 1. Pack Pit Data into a readable string for the "Notes" column
    // Since backend doesn't have "Drivetrain" columns, we save it here.
    const pitDataString = `[PIT REPORT] 
    [Drive: ${form.drivetrain}] 
    [Wt: ${form.weight}lbs] [Size: ${form.width}x${form.length}] 
    [Climb: ${form.canClimb ? 'Yes' : 'No'}] 
    [Auto: ${form.autoRoutines}] 
    | Notes: ${form.notes}`;

    // 2. Construct Payload (Masquerading as a Practice Match)
    const payload = {
      createdAt: new Date().toISOString(),
      eventCode: '2026A', // Default Event
      matchType: 'PRACTICE', // Mark as Practice so it doesn't mess up Qual stats
      matchNumber: 0, // Match 0 = Pit
      teamNumber: parseInt(form.teamNumber),
      notes: pitDataString.replace(/\n/g, ''), // Flatten newlines
      trenchOrBump: 'TRENCH',
      minorFouls: 0,
      majorFouls: 0,
      // Fill required fields with empty zeros
      auto: { notes: "", movement: false, hubScore: 0, hubMisses: 0, level1: false },
      teleop: { notes: "", hubScore: 0, hubMisses: 0, level: null },
      endgame: { notes: "", hubScore: 0, hubMisses: 0, level: null }
    };

    try {
      // Direct Online Upload (Since you said offline isn't needed here)
      const res = await fetch(`${API_URL}/report`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (res.status === 201) {
        Alert.alert("Success", `Pit Data for Team ${form.teamNumber} saved!`);
        // Reset Form
        setForm({ ...form, teamNumber: '', weight: '', notes: '' });
      } else {
        const err = await res.json();
        Alert.alert("Error", err.code || "Upload failed");
      }
    } catch (e) {
      Alert.alert("Network Error", "Check internet connection");
    }
    setLoading(false);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={onBack}><Text style={styles.backLink}>← Dashboard</Text></TouchableOpacity>
        <Text style={styles.headerTitle}>Pit Scouting</Text>
        <View style={{width: 40}} /> 
      </View>

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

        <Text style={styles.label}>Physical Specs</Text>
        <View style={styles.row}>
          <TextInput style={[styles.input, {flex:1}]} placeholder="Weight (lbs)" placeholderTextColor="#666" keyboardType="numeric" value={form.weight} onChangeText={t => setForm({...form, weight: t})} />
          <TextInput style={[styles.input, {flex:1}]} placeholder="Width (in)" placeholderTextColor="#666" keyboardType="numeric" value={form.width} onChangeText={t => setForm({...form, width: t})} />
          <TextInput style={[styles.input, {flex:1}]} placeholder="Length (in)" placeholderTextColor="#666" keyboardType="numeric" value={form.length} onChangeText={t => setForm({...form, length: t})} />
        </View>

        <Text style={styles.label}>Capabilities</Text>
        <TouchableOpacity 
          style={[styles.toggleBtn, form.canClimb && styles.activeGreen]}
          onPress={() => setForm({...form, canClimb: !form.canClimb})}
        >
          <Text style={styles.toggleText}>Can they Climb? {form.canClimb ? "✅ YES" : "❌ NO"}</Text>
        </TouchableOpacity>

        <Text style={styles.label}>Auto Routines (Describe)</Text>
        <TextInput 
          style={styles.textArea} 
          multiline 
          placeholder="e.g. 3 piece, starts left..." 
          placeholderTextColor="#666"
          value={form.autoRoutines}
          onChangeText={t => setForm({...form, autoRoutines: t})}
        />

        <Text style={styles.label}>General Notes / Photos?</Text>
        <TextInput 
          style={styles.textArea} 
          multiline 
          placeholder="Observations..." 
          placeholderTextColor="#666"
          value={form.notes}
          onChangeText={t => setForm({...form, notes: t})}
        />

        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff"/> : <Text style={styles.saveText}>Upload Pit Report</Text>}
        </TouchableOpacity>

      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212', padding: 20 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  backLink: { color: '#0a84ff', fontSize: 16 },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  card: { backgroundColor: '#1e1e1e', padding: 20, borderRadius: 15, borderWidth: 1, borderColor: '#333' },
  label: { color: '#aaa', marginTop: 15, marginBottom: 8, fontSize: 14 },
  input: { backgroundColor: '#2c2c2c', color: '#fff', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#444' },
  row: { flexDirection: 'row', gap: 10 },
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