// Simple feedforward neural net used as the car's "brain"
export class NeuralNet {
  // Topology e.g. [6, 8, 2] = 6 inputs, 8 hidden, 2 outputs
  constructor(topology) {
    this.topology = topology;
    this.weights = [];
    for (let i = 1; i < topology.length; i++) {
      const fanIn = topology[i - 1], fanOut = topology[i];
      for (let j = 0; j < fanOut; j++) {
        for (let k = 0; k < fanIn; k++) this.weights.push(Math.random() * 2 - 1);
        this.weights.push(Math.random() * 0.4 - 0.2);
      }
    }
  }

  // Forward pass: feed inputs through layers, tanh activation
  predict(inputs) {
    let current = inputs.slice();
    let wi = 0;
    for (let l = 1; l < this.topology.length; l++) {
      const prev = current;
      current = [];
      for (let j = 0; j < this.topology[l]; j++) {
        let sum = 0;
        for (let k = 0; k < prev.length; k++) sum += prev[k] * this.weights[wi++];
        sum += this.weights[wi++];
        current.push(Math.tanh(sum));
      }
    }
    return current;
  }

  clone() {
    const nn = new NeuralNet(this.topology);
    nn.weights = this.weights.slice();
    return nn;
  }

  // Randomly nudge weights: rate = probability, strength = magnitude
  mutate(rate, strength) {
    for (let i = 0; i < this.weights.length; i++) {
      if (Math.random() < rate) {
        this.weights[i] += (Math.random() * 2 - 1) * strength;
      }
    }
  }

  // Single-point crossover: take first half from parent a, second from b
  static crossover(a, b) {
    const child = a.clone();
    const split = Math.floor(Math.random() * child.weights.length);
    for (let i = split; i < child.weights.length; i++) {
      child.weights[i] = b.weights[i];
    }
    return child;
  }
}
