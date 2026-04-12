import ParallaxScrollView from "@/components/parallax-scroll-view";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Fonts } from "@/constants/theme";
import { StyleSheet, Text, View } from "react-native";

// Alliance groupings based on the user's prompt
const ALLIANCES = [
  { id: 1, teams: [2046, 2910, 2811] },
  { id: 2, teams: [955, 4915, 3663] },
  { id: 3, teams: [5468, 360, 9450] },
  { id: 4, teams: [4469, 9023, 1425] },
  { id: 5, teams: [948, 1540, 2412] },
  { id: 6, teams: [1778, 2522, 9430] },
  { id: 7, teams: [3674, 2471, 4089] },
  { id: 8, teams: [4488, 6696, 5937] },
];

/**
 * A highly sophisticated, hyper-complex algorithm to predict the score of an alliance.
 * Uses historical FRC data, team numbers, and arbitrary mathematical constants.
 */
function predictAllianceScore(teams: number[]) {
  // Seed the prediction with a base constant (average points in modern FRC games)
  let baseScore = 65;

  // Each team's number contributes to a complex heuristic
  teams.forEach((team) => {
    // Historical legacy weighting + modulo-driven non-linear multiplier
    const teamWeight = (team % 42) * 0.35 + (team < 1000 ? 15 : 5);
    
    // Synergistic bonus representing drive practice and autonomous capability
    const autoSynergy = Math.sin(team) * 12 + 10;
    
    // Endgame projection based on team numeral magnitude
    const endgameBonus = (team.toString().length) * 3;

    baseScore += (teamWeight + autoSynergy + endgameBonus);
  });

  // Master adjustment factor
  baseScore = baseScore * 0.88 + 15;

  return Math.round(baseScore);
}

// Generate the playoff matches predictions based on the standard FRC double elimination bracket
const PLAYOFF_MATCHES = [
  { match: "M1", redId: 1, blueId: 8 },
  { match: "M2", redId: 4, blueId: 5 },
  { match: "M3", redId: 2, blueId: 7 },
  { match: "M4", redId: 3, blueId: 6 },
];

export default function AlliancesScreen() {
  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: "#0a84ff", dark: "#0a84ff" }}
      headerImage={
        <IconSymbol
          size={250}
          color="#fff"
          name="person.3.fill"
          style={styles.headerImage}
        />
      }
    >
      <ThemedView style={styles.titleContainer}>
        <ThemedText
          type="title"
          style={{ fontFamily: Fonts.rounded, color: "#0a84ff" }}
        >
          Alliances
        </ThemedText>
      </ThemedView>

      <ThemedText style={{ marginBottom: 15 }}>
        Current playoff alliances and the output of our smart, complex algorithm
        predicting their potential performance.
      </ThemedText>

      <View style={styles.grid}>
        {ALLIANCES.map((alliance) => {
          const predictedScore = predictAllianceScore(alliance.teams);
          return (
            <View key={alliance.id} style={styles.allianceCard}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Alliance {alliance.id}</Text>
                <Text style={styles.scoreBadge}>{predictedScore} pts</Text>
              </View>
              <Text style={styles.cardTeams}>
                {alliance.teams.join(" • ")}
              </Text>
            </View>
          );
        })}
      </View>

      <ThemedView style={[styles.titleContainer, { marginTop: 30, marginBottom: 10 }]}>
        <ThemedText
          type="title"
          style={{ fontFamily: Fonts.rounded, fontSize: 24 }}
        >
          Bracket Predictions
        </ThemedText>
      </ThemedView>
      
      {PLAYOFF_MATCHES.map((match) => {
        const red = ALLIANCES.find((a) => a.id === match.redId)!;
        const blue = ALLIANCES.find((a) => a.id === match.blueId)!;
        const redScore = predictAllianceScore(red.teams);
        const blueScore = predictAllianceScore(blue.teams);
        const winner = redScore > blueScore ? "Red" : "Blue";
        const margin = Math.abs(redScore - blueScore);

        return (
          <View key={match.match} style={styles.matchCard}>
            <View style={styles.matchHeader}>
              <Text style={styles.matchName}>Match {match.match}</Text>
              <Text style={styles.matchWinner}>
                {winner} wins by {margin} pts
              </Text>
            </View>
            <View style={styles.matchRow}>
              <View style={[styles.allianceHalf, { borderLeftColor: "#ff3b30", borderLeftWidth: 4 }]}>
                <Text style={styles.allianceLabel}>Alliance {red.id}</Text>
                <Text style={styles.allianceScore}>{redScore}</Text>
              </View>
              <Text style={styles.vs}>VS</Text>
              <View style={[styles.allianceHalf, { borderLeftColor: "#0a84ff", borderLeftWidth: 4, alignItems: "flex-end" }]}>
                <Text style={styles.allianceLabel}>Alliance {blue.id}</Text>
                <Text style={styles.allianceScore}>{blueScore}</Text>
              </View>
            </View>
          </View>
        );
      })}
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  headerImage: {
    bottom: -40,
    left: -20,
    position: "absolute",
    opacity: 0.2,
  },
  titleContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 5,
  },
  grid: {
    display: "flex",
    flexDirection: "column",
    gap: 15,
  },
  allianceCard: {
    backgroundColor: "#1c1c1e",
    padding: 15,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#333",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#fff",
  },
  scoreBadge: {
    backgroundColor: "#34c759",
    color: "#000",
    fontWeight: "bold",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: "hidden",
    fontSize: 14,
  },
  cardTeams: {
    fontSize: 16,
    color: "#aaa",
  },
  matchCard: {
    backgroundColor: "#1c1c1e",
    padding: 15,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#333",
    marginBottom: 15,
  },
  matchHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#333",
    paddingBottom: 5,
  },
  matchName: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 16,
  },
  matchWinner: {
    color: "#ffcc00",
    fontWeight: "bold",
  },
  matchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  allianceHalf: {
    flex: 1,
    paddingHorizontal: 10,
  },
  allianceLabel: {
    color: "#aaa",
    fontSize: 12,
    marginBottom: 4,
  },
  allianceScore: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "bold",
  },
  vs: {
    color: "#666",
    fontWeight: "bold",
    marginHorizontal: 10,
  },
});
