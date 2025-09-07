let animationFrameId = null;
const tasks = new Set();

function runTasks(currentTime) {
  if (tasks.size === 0) {
    animationFrameId = null;
    return;
  }

  tasks.forEach((task) => task(currentTime));
  animationFrameId = requestAnimationFrame(runTasks);
}

export const animationScheduler = {
  add(task) {
    tasks.add(task);
    if (!animationFrameId) {
      animationFrameId = requestAnimationFrame(runTasks);
    }
  },
  remove(task) {
    tasks.delete(task);
    if (tasks.size === 0 && animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  },
};
