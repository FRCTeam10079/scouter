import { Image } from 'expo-image';
import { useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';

// Sample team data
const initialTeams = [
  { id: '1', teamNumber: '2394' },
  { id: '2', teamNumber: '23494' },
  { id: '3', teamNumber: '10079' },
];

type Team = {
  id: string;
  teamNumber: string;
};

export default function DashboardScreen() {
  const [teams] = useState<Team[]>(initialTeams);

  const renderTeamItem = ({ item }: { item: Team }) => (
    <Pressable style={styles.teamItem}>
      <View style={styles.teamImagePlaceholder} />
      <ThemedText style={styles.teamNumber}>#{item.teamNumber}</ThemedText>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <ThemedView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Image
              source={require('@/assets/images/ArrowdynamicsLogo.png')}
              style={styles.logo}
              contentFit="contain"
            />
            <ThemedText type="title" style={styles.headerTitle}>
              Arrowdynamics Scouter
            </ThemedText>
          </View>
          <View style={styles.headerRight}>
            <Pressable style={styles.addButton}>
              <IconSymbol name="plus" size={24} color={Colors.light.text} />
            </Pressable>
            <View style={styles.profilePlaceholder} />
          </View>
        </View>

        {/* Sort By */}
        <View style={styles.sortContainer}>
          <Pressable style={styles.sortButton}>
            <ThemedText style={styles.sortText}>Sort By</ThemedText>
          </Pressable>
        </View>

        {/* Team List */}
        <FlatList
          data={teams}
          renderItem={renderTeamItem}
          keyExtractor={(item) => item.id}
          style={styles.teamList}
          contentContainerStyle={styles.teamListContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      </ThemedView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#fff',
  },
  container: {
    flex: 1,
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logo: {
    width: 40,
    height: 40,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  addButton: {
    padding: 8,
  },
  profilePlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ccc',
  },
  sortContainer: {
    alignItems: 'flex-end',
    paddingVertical: 12,
  },
  sortButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  sortText: {
    fontSize: 14,
    color: '#333',
  },
  teamList: {
    flex: 1,
  },
  teamListContent: {
    paddingBottom: 20,
  },
  teamItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
    gap: 16,
  },
  teamImagePlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 4,
    backgroundColor: '#e0e0e0',
  },
  teamNumber: {
    fontSize: 16,
    fontWeight: '500',
  },
  separator: {
    height: 1,
    backgroundColor: '#e0e0e0',
    marginHorizontal: 12,
  },
});
