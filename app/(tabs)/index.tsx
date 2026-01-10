import React, { useState } from 'react';
import {
  Alert,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';


interface MatchData {
  team: string;
  match: string;
}

interface GameCounters {
  [key: string]: number; 
}

export default function App() {
  // --- State ---
  const [matchInfo, setMatchInfo] = useState<MatchData>({ team: '', match: '' });
  
  const [counters, setCounters] = useState<GameCounters>({
    auto1: 0,
    auto2: 0,
    teleop1: 0,
    teleop2: 0,
    endgame: 0,
  });

  const [notes, setNotes] = useState<string>('');

  const handleCounter = (key: string, adjustment: number) => {
    setCounters(prev => {
      const newValue = prev[key] + adjustment;

      return { ...prev, [key]: newValue < 0 ? 0 : newValue }; 
    });
  };

  const submitData = () => {
    const dataToSave = { ...matchInfo, ...counters, notes };
    console.log('2026 Match Data:', dataToSave);
    
    // Web vs Mobile alerts
    if (Platform.OS === 'web') {
      window.alert('Match Saved! Check console.');
    } else {
      Alert.alert('Success', 'Match data collected!');
    }
    
    // Reset form
    setMatchInfo({ team: '', match: '' });
    setCounters({ auto1: 0, auto2: 0, teleop1: 0, teleop2: 0, endgame: 0 });
    setNotes('');
  };

  const CounterRow = ({ label, stateKey }: { label: string; stateKey: string }) => (
    <View style={styles.counterRow}>
      <Text style={styles.counterLabel}>{label}</Text>
      <View style={styles.stepper}>
        <TouchableOpacity 
          style={[styles.btn, styles.btnMinus]} 
          onPress={() => handleCounter(stateKey, -1)}
        >
          <Text style={styles.btnText}>-</Text>
        </TouchableOpacity>
        
        <Text style={styles.countValue}>{counters[stateKey]}</Text>
        
        <TouchableOpacity 
          style={[styles.btn, styles.btnPlus]} 
          onPress={() => handleCounter(stateKey, 1)}
        >
          <Text style={styles.btnText}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>FRC Scout 2026</Text>
        </View>

        {/* Inputs */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Match Info</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="Team #"
              placeholderTextColor="#888"
              keyboardType="numeric"
              value={matchInfo.team}
              onChangeText={(t) => setMatchInfo({...matchInfo, team: t})}
            />
            <TextInput
              style={styles.input}
              placeholder="Match #"
              placeholderTextColor="#888"
              keyboardType="numeric"
              value={matchInfo.match}
              onChangeText={(t) => setMatchInfo({...matchInfo, match: t})}
            />
          </View>
        </View>

        {/* Autonomous Phase */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Autonomous</Text>
          <CounterRow label="Game Piece A" stateKey="auto1" />
          <CounterRow label="Game Piece B" stateKey="auto2" />
        </View>

        {/* Teleop Phase */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Teleop</Text>
          <CounterRow label="Game Piece A" stateKey="teleop1" />
          <CounterRow label="Game Piece B" stateKey="teleop2" />
          <CounterRow label="Endgame Action" stateKey="endgame" />
        </View>

        {/* Notes */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Notes</Text>
          <TextInput
            style={styles.notesInput}
            multiline
            placeholder="Enter any additional notes here..."
            placeholderTextColor="#888"
            value={notes}
            onChangeText={setNotes}
          />
        </View>

        {/* Save Button */}
        <TouchableOpacity style={styles.submitBtn} onPress={submitData}>
          <Text style={styles.submitText}>Save Match</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}


const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#121212', 
  },
  container: {
    padding: 20,
    maxWidth: 600,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    marginBottom: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  section: {
    backgroundColor: '#1e1e1e', // Slightly lighter grey for cards
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#333',
  },
  sectionHeader: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 10,
    color: '#ddd',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    paddingBottom: 5,
  },
  inputRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#444',
    padding: 12,
    borderRadius: 8,
    fontSize: 16,
    backgroundColor: '#2c2c2c',
    color: '#fff',
  },
  // Counter Styles
  counterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  counterLabel: {
    fontSize: 16,
    color: '#ccc',
    flex: 1,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  btn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
  },
  btnMinus: {
    backgroundColor: '#5c2b2b', // Dark red
  },
  btnPlus: {
    backgroundColor: '#2b5c35', // Dark green
  },
  btnText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  countValue: {
    fontSize: 18,
    fontWeight: 'bold',
    width: 30,
    textAlign: 'center',
    color: '#fff',
  },
  // Notes
  notesInput: {
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 8,
    padding: 10,
    height: 80,
    textAlignVertical: 'top',
    backgroundColor: '#2c2c2c',
    color: '#fff',
  },
  submitBtn: {
    backgroundColor: '#0a84ff', 
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 40,
  },
  submitText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
});