import { View, FlatList, StyleSheet, Text } from "react-native";
import ProjectCard from "../components/ProjectCard";

type Project = {
  id: string;
  title: string;
  status: string;
  volunteers: number;
  description: string;
};

const projects: Project[] = [
  {
    id: "1",
    title: "Tree Planting",
    status: "Ongoing",
    volunteers: 24,
    description: "Join us in planting 500 trees in the local park.",
  },
  {
    id: "2",
    title: "Community Feeding",
    status: "Completed",
    volunteers: 18,
    description: "Provided meals to 200+ community members.",
  },
  {
    id: "3",
    title: "School Renovation",
    status: "Planning",
    volunteers: 0,
    description: "Help renovate classrooms and sports facilities.",
  },
  {
    id: "4",
    title: "Beach Cleanup",
    status: "Ongoing",
    volunteers: 32,
    description: "Clean beaches and protect marine life.",
  },
];

export default function ProjectsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Active & Upcoming Projects</Text>
      <FlatList
        data={projects}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ProjectCard
            id={item.id}
            title={item.title}
            status={item.status}
            volunteers={item.volunteers}
            description={item.description}
          />
        )}
        scrollEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 15,
    backgroundColor: "#f5f5f5",
  },
  heading: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 15,
    color: "#333",
  },
});