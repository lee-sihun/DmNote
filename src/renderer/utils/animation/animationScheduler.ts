type Task = (currentTime: number) => void;

let animationFrameId: number | null = null;
const tasks: Set<Task> = new Set();

function runTasks(currentTime: number): void {
  if (tasks.size === 0) {
    animationFrameId = null;
    return;
  }

  tasks.forEach((task) => task(currentTime));
  animationFrameId = requestAnimationFrame(runTasks);
}

export const animationScheduler = {
  add(task: Task): void {
    tasks.add(task);
    if (!animationFrameId) {
      animationFrameId = requestAnimationFrame(runTasks);
    }
  },
  remove(task: Task): void {
    tasks.delete(task);
    if (tasks.size === 0 && animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  },
};
