// DemoExample.java
import java.util.*;

public class DemoExample {
    // Violation: Exposed mutable collection (Guideline #4)
    public List<String> items = new ArrayList<>();
    
    // Violation: Returning null instead of Optional (Guideline #3)
    public Integer findMax(List<Integer> numbers) {
        if (numbers == null || numbers.isEmpty()) {
            return null;
        }
        int max = Integer.MIN_VALUE;
        for (int num : numbers) {
            if (num > max) max = num;
        }
        return max;
    }

    // Violation: Using obsolete Vector class (Guideline #6)
    public void processData() {
        Vector<String> data = new Vector<>();
        data.add("test");
        
        try {
            // Violation: Generic exception catching (Guideline #5)
        } catch (Exception e) {
            System.out.println("Error occurred");
        }
    }

    // Violation: Not overriding equals/hashCode (Guideline #10)
    class Coin {
        private final int value;
        
        public Coin(int value) {
            this.value = value;
        }
    }
}
